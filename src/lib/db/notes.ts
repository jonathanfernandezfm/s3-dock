import prisma from "@/lib/db/prisma";
import type { FileNote } from "@/generated/prisma/client";

export type CreateNoteInput = {
  connectionId: string;
  authorId: string;
  authorDisplayName: string;
  authorImageUrl: string | null;
  bucket: string;
  key: string;
  body: string;
};

export async function createNote(input: CreateNoteInput): Promise<FileNote> {
  return prisma.fileNote.create({
    data: {
      connectionId: input.connectionId,
      authorId: input.authorId,
      authorDisplayName: input.authorDisplayName,
      authorImageUrl: input.authorImageUrl,
      bucket: input.bucket,
      key: input.key,
      body: input.body,
    },
  });
}

export async function updateNote(
  id: string,
  userId: string,
  isAdmin: boolean,
  body: string
): Promise<FileNote | null> {
  const existing = await prisma.fileNote.findUnique({ where: { id } });
  if (!existing) return null;
  if (!isAdmin && existing.authorId !== userId) return null;

  return prisma.fileNote.update({
    where: { id },
    data: { body },
  });
}

export async function deleteNote(
  id: string,
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  const existing = await prisma.fileNote.findUnique({ where: { id } });
  if (!existing) return false;
  if (!isAdmin && existing.authorId !== userId) return false;

  await prisma.fileNote.delete({ where: { id } });
  return true;
}

export async function listNotesForKey(
  connectionId: string,
  bucket: string,
  key: string
): Promise<FileNote[]> {
  return prisma.fileNote.findMany({
    where: { connectionId, bucket, key },
    orderBy: { createdAt: "desc" },
  });
}

export async function countNotesForKeys(
  connectionId: string,
  bucket: string,
  keys: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (keys.length === 0) return result;

  const rows = await prisma.fileNote.groupBy({
    by: ["key"],
    where: { connectionId, bucket, key: { in: keys } },
    _count: { _all: true },
  });

  for (const row of rows as Array<{ key: string; _count: { _all: number } }>) {
    result.set(row.key, row._count._all);
  }
  return result;
}

type AuthorishUser = {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  imageUrl?: string | null;
};

export function formatAuthorDisplayName(user: AuthorishUser): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  );
}
