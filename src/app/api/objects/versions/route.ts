import { NextResponse } from "next/server";
import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@/lib/s3/client";
import { getConnectionAccessById } from "@/lib/db/connections";
import { withAuth } from "@/lib/auth";
import { normalizeVersions } from "@/lib/versions/normalize";
import type { ListObjectVersionsResponse } from "@/types/s3";

interface ListBody {
  connectionId: string;
  bucket: string;
  prefix?: string;
  key?: string;
  keyMarker?: string;
  versionIdMarker?: string;
  maxKeys?: number;
}

export const POST = withAuth(async (req, { user }) => {
  try {
    const body: ListBody = await req.json();
    const { connectionId, bucket, prefix, key, keyMarker, versionIdMarker, maxKeys } = body;

    if (!connectionId || !bucket) {
      return NextResponse.json(
        { error: "connectionId and bucket are required" },
        { status: 400 },
      );
    }

    const access = await getConnectionAccessById(connectionId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const client = createS3Client(access.connection);
    const sdkResponse = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key ?? prefix ?? "",
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
        MaxKeys: maxKeys ?? 1000,
      }),
    );

    let versions = normalizeVersions(sdkResponse);
    if (key) {
      versions = versions.filter((v) => v.key === key);
    }

    const response: ListObjectVersionsResponse = {
      versions,
      isTruncated: sdkResponse.IsTruncated ?? false,
      nextKeyMarker: sdkResponse.NextKeyMarker,
      nextVersionIdMarker: sdkResponse.NextVersionIdMarker,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
