import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client } from "@/lib/s3/client";
import { getConnectionAccessById } from "@/lib/db/connections";
import { withAuth } from "@/lib/auth";
import { meterOperation } from "@/lib/subscriptions";

export const POST = withAuth(async (req, { user }) => {
  try {
    const {
      connectionId,
      bucket,
      keys,
    }: { connectionId: string; bucket: string; keys: string[] } =
      await req.json();

    if (!connectionId || !bucket || !Array.isArray(keys) || keys.length === 0) {
      return NextResponse.json(
        { error: "connectionId, bucket, and a non-empty keys array are required" },
        { status: 400 }
      );
    }

    const cappedKeys = keys.slice(0, 200);

    const access = await getConnectionAccessById(connectionId, user.id);
    if (!access) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    const tier = user.subscription?.tier ?? "FREE";
    const meter = await meterOperation(user.id, tier);
    if (!meter.allowed) {
      return NextResponse.json({ error: meter.reason }, { status: 403 });
    }

    const client = createS3Client(access.connection);

    const urls: Record<string, string> = {};
    const errors: Record<string, string> = {};

    await Promise.all(
      cappedKeys.map(async (key) => {
        try {
          const command = new GetObjectCommand({ Bucket: bucket, Key: key });
          urls[key] = await getSignedUrl(client, command, { expiresIn: 3600 });
        } catch (err) {
          errors[key] = err instanceof Error ? err.message : "Unknown error";
        }
      })
    );

    const response: { urls: Record<string, string>; errors?: Record<string, string> } = { urls };
    if (Object.keys(errors).length > 0) {
      response.errors = errors;
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
