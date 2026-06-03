import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import prisma from "@/lib/db/prisma";
import { updateNote, deleteNote } from "@/lib/db/notes";

const MAX_BODY_LENGTH = 4000;

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withAuth<RouteContext>(
  async (req: NextRequest, { user, params }) => {
    const { id } = await params;
    const { body } = await req.json();

    const trimmed = typeof body === "string" ? body.trim() : "";
    if (!trimmed) {
      return NextResponse.json(
        { error: "Body cannot be empty" },
        { status: 400 }
      );
    }
    if (trimmed.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `Body too long (max ${MAX_BODY_LENGTH} chars)` },
        { status: 400 }
      );
    }

    const note = await prisma.fileNote.findUnique({ where: { id } });
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const access = await getConnectionAccessById(note.connectionId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const isAdmin = access.role === "ADMIN";
    const updated = await updateNote(id, user.id, isAdmin, trimmed);
    if (!updated) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      id: updated.id,
      authorId: updated.authorId,
      authorDisplayName: updated.authorDisplayName,
      authorImageUrl: updated.authorImageUrl,
      bucket: updated.bucket,
      key: updated.key,
      body: updated.body,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      canEdit: true,
    });
  }
);

export const DELETE = withAuth<RouteContext>(
  async (_req: NextRequest, { user, params }) => {
    const { id } = await params;

    const note = await prisma.fileNote.findUnique({ where: { id } });
    if (!note) {
      return new NextResponse(null, { status: 204 });
    }

    const access = await getConnectionAccessById(note.connectionId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isAdmin = access.role === "ADMIN";
    const ok = await deleteNote(id, user.id, isAdmin);
    if (!ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return new NextResponse(null, { status: 204 });
  }
);
