import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  getConnectionById,
  updateConnection,
  deleteConnection,
  type ConnectionUpdate,
} from "@/lib/db/connections";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/connections/[id] - Get a single connection
export const GET = withAuth<RouteContext>(async (req, { user, params }) => {
  const { id } = params;
  const connection = await getConnectionById(id, user.id);

  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  // Return connection with secret key for operations
  return NextResponse.json({
    id: connection.id,
    name: connection.name,
    endpoint: connection.endpoint,
    region: connection.region,
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
    forcePathStyle: connection.forcePathStyle,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  });
});

// PUT /api/connections/[id] - Update a connection
export const PUT = withAuth<RouteContext>(async (req, { user, params }) => {
  const { id } = params;
  const body: ConnectionUpdate = await req.json();

  const connection = await updateConnection(id, user.id, body);

  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: connection.id,
    name: connection.name,
    endpoint: connection.endpoint,
    region: connection.region,
    accessKeyId: connection.accessKeyId,
    forcePathStyle: connection.forcePathStyle,
    updatedAt: connection.updatedAt,
  });
});

// DELETE /api/connections/[id] - Delete a connection
export const DELETE = withAuth<RouteContext>(async (req, { user, params }) => {
  const { id } = params;

  const connection = await deleteConnection(id, user.id);

  if (!connection) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
});
