import { NextResponse } from "next/server";
import {
  ListMultipartUploadsCommand,
  type ListMultipartUploadsCommandOutput,
} from "@aws-sdk/client-s3";
import { createS3Client } from "@/lib/s3/client";
import { getConnectionAccessById } from "@/lib/db/connections";
import { withAuth } from "@/lib/auth";
import type { IncompleteUpload } from "@/types/s3";

type RouteContext = { params: Promise<{ bucket: string }> };

export const POST = withAuth<RouteContext>(async (req, { user, params }) => {
  try {
    const { bucket } = await params;
    const { connectionId }: { connectionId: string } = await req.json();

    if (!connectionId || !bucket) {
      return NextResponse.json(
        { error: "connectionId and bucket name are required" },
        { status: 400 }
      );
    }

    const access = await getConnectionAccessById(connectionId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const client = createS3Client(access.connection);

    const uploads: IncompleteUpload[] = [];
    let keyMarker: string | undefined = undefined;
    let uploadIdMarker: string | undefined = undefined;

    for (;;) {
      const response: ListMultipartUploadsCommandOutput = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: bucket,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        })
      );

      for (const u of response.Uploads ?? []) {
        if (!u.Key || !u.UploadId || !u.Initiated) continue;
        uploads.push({
          key: u.Key,
          uploadId: u.UploadId,
          initiated: u.Initiated.toISOString(),
          storageClass: u.StorageClass ?? null,
          initiatorDisplayName: u.Initiator?.DisplayName ?? null,
          initiatorId: u.Initiator?.ID ?? null,
        });
      }

      if (!response.IsTruncated) break;
      keyMarker = response.NextKeyMarker ?? undefined;
      uploadIdMarker = response.NextUploadIdMarker ?? undefined;
    }

    return NextResponse.json(uploads);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
