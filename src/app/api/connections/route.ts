import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  getConnectionsByUserId,
  createConnection,
  type ConnectionInput,
} from "@/lib/db/connections";
import { canCreateConnection } from "@/lib/subscriptions";

// GET /api/connections - List user's connections
export const GET = withAuth(async (req, { user }) => {
  const connections = await getConnectionsByUserId(user.id);

  // Don't expose secret keys in the list response
  const safeConnections = connections.map((conn) => ({
    id: conn.id,
    name: conn.name,
    endpoint: conn.endpoint,
    region: conn.region,
    accessKeyId: conn.accessKeyId,
    forcePathStyle: conn.forcePathStyle,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  }));

  return NextResponse.json(safeConnections);
});

// POST /api/connections - Create a new connection
export const POST = withAuth(async (req, { user }) => {
  const body: ConnectionInput = await req.json();

  // Check tier limits
  const tier = user.subscription?.tier ?? "FREE";
  const limitCheck = await canCreateConnection(user.id, tier);

  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 403 });
  }

  if (!body.endpoint || !body.accessKeyId || !body.secretAccessKey) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: endpoint, accessKeyId, secretAccessKey",
      },
      { status: 400 }
    );
  }

  const connection = await createConnection(user.id, {
    name: body.name,
    endpoint: body.endpoint,
    region: body.region || "us-east-1",
    accessKeyId: body.accessKeyId,
    secretAccessKey: body.secretAccessKey,
    forcePathStyle: body.forcePathStyle ?? true,
  });

  return NextResponse.json({
    id: connection.id,
    name: connection.name,
    endpoint: connection.endpoint,
    region: connection.region,
    accessKeyId: connection.accessKeyId,
    forcePathStyle: connection.forcePathStyle,
    createdAt: connection.createdAt,
  });
});
