import { NextResponse } from "next/server";
import { DeleteBucketCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@/lib/s3/client";
import { getConnectionById } from "@/lib/db/connections";
import { withAuth } from "@/lib/auth";

type RouteContext = { params: Promise<{ bucket: string }> };

export const DELETE = withAuth<RouteContext>(async (req, { user, params }) => {
  try {
    const { bucket } = params;
    const { connectionId }: { connectionId: string } = await req.json();

    if (!connectionId || !bucket) {
      return NextResponse.json(
        { error: "connectionId and bucket name are required" },
        { status: 400 }
      );
    }

    const connection = await getConnectionById(connectionId, user.id);
    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    const client = createS3Client(connection);
    const command = new DeleteBucketCommand({ Bucket: bucket });
    await client.send(command);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
