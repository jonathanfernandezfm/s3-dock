import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import {
  createNote,
  listNotesForKey,
  formatAuthorDisplayName,
} from "@/lib/db/notes";

const MAX_BODY_LENGTH = 4000;

type FileNoteResponse = {
  id: string;
  authorId: string | null;
  authorDisplayName: string;
  authorImageUrl: string | null;
  bucket: string;
  key: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

function toResponse(
  note: {
    id: string;
    authorId: string | null;
    authorDisplayName: string;
    authorImageUrl: string | null;
    bucket: string;
    key: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
  },
  userId: string,
  isAdmin: boolean
): FileNoteResponse {
  return {
    id: note.id,
    authorId: note.authorId,
    authorDisplayName: note.authorDisplayName,
    authorImageUrl: note.authorImageUrl,
    bucket: note.bucket,
    key: note.key,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    canEdit: isAdmin || note.authorId === userId,
  };
}

export const GET = withAuth(async (req: NextRequest, { user }) => {
  const { searchParams } = req.nextUrl;
  const connectionId = searchParams.get("connectionId");
  const bucket = searchParams.get("bucket");
  const key = searchParams.get("key");

  if (!connectionId || !bucket || !key) {
    return NextResponse.json(
      { error: "connectionId, bucket, and key are required" },
      { status: 400 }
    );
  }

  const access = await getConnectionAccessById(connectionId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const notes = await listNotesForKey(connectionId, bucket, key);
  const isAdmin = access.role === "ADMIN";

  return NextResponse.json({
    notes: notes.map((n) => toResponse(n, user.id, isAdmin)),
  });
});

export const POST = withAuth(async (req: NextRequest, { user }) => {
  const { connectionId, bucket, key, body } = await req.json();

  if (!connectionId || !bucket || !key) {
    return NextResponse.json(
      { error: "connectionId, bucket, and key are required" },
      { status: 400 }
    );
  }

  const trimmed = typeof body === "string" ? body.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "Body cannot be empty" }, { status: 400 });
  }
  if (trimmed.length > MAX_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Body too long (max ${MAX_BODY_LENGTH} chars)` },
      { status: 400 }
    );
  }

  const access = await getConnectionAccessById(connectionId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const created = await createNote({
    connectionId,
    authorId: user.id,
    authorDisplayName: formatAuthorDisplayName(user),
    authorImageUrl: user.imageUrl ?? null,
    bucket,
    key,
    body: trimmed,
  });

  const isAdmin = access.role === "ADMIN";
  return NextResponse.json(toResponse(created, user.id, isAdmin));
});
