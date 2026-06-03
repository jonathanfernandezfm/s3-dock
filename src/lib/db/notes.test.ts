import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    fileNote: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import prisma from "@/lib/db/prisma";
import {
  createNote,
  updateNote,
  deleteNote,
  listNotesForKey,
  countNotesForKeys,
} from "./notes";

const baseCreate = {
  connectionId: "conn-1",
  authorId: "user-1",
  authorDisplayName: "Alice Smith",
  authorImageUrl: null,
  bucket: "my-bucket",
  key: "folder/file.txt",
  body: "Hello world",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createNote", () => {
  test("creates a row with the provided fields", async () => {
    (prisma.fileNote.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
    });
    await createNote(baseCreate);

    expect(prisma.fileNote.create).toHaveBeenCalledOnce();
    expect(prisma.fileNote.create).toHaveBeenCalledWith({
      data: {
        connectionId: "conn-1",
        authorId: "user-1",
        authorDisplayName: "Alice Smith",
        authorImageUrl: null,
        bucket: "my-bucket",
        key: "folder/file.txt",
        body: "Hello world",
      },
    });
  });
});

describe("updateNote", () => {
  test("returns null when the note does not exist", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await updateNote("missing", "user-1", false, "new body");
    expect(result).toBeNull();
    expect(prisma.fileNote.update).not.toHaveBeenCalled();
  });

  test("returns null when requester is not author and not admin", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      authorId: "someone-else",
    });
    const result = await updateNote("n-1", "user-1", false, "new body");
    expect(result).toBeNull();
    expect(prisma.fileNote.update).not.toHaveBeenCalled();
  });

  test("updates when requester is the author", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      authorId: "user-1",
    });
    (prisma.fileNote.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      body: "new body",
    });
    const result = await updateNote("n-1", "user-1", false, "new body");
    expect(result).not.toBeNull();
    expect(prisma.fileNote.update).toHaveBeenCalledWith({
      where: { id: "n-1" },
      data: { body: "new body" },
    });
  });

  test("updates when requester is admin even if not author", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      authorId: "someone-else",
    });
    (prisma.fileNote.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      body: "moderated",
    });
    const result = await updateNote("n-1", "user-1", true, "moderated");
    expect(result).not.toBeNull();
    expect(prisma.fileNote.update).toHaveBeenCalledOnce();
  });
});

describe("deleteNote", () => {
  test("returns false when note missing", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await deleteNote("missing", "user-1", false)).toBe(false);
  });

  test("returns false when not author and not admin", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      authorId: "someone-else",
    });
    expect(await deleteNote("n-1", "user-1", false)).toBe(false);
    expect(prisma.fileNote.delete).not.toHaveBeenCalled();
  });

  test("deletes when author", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      authorId: "user-1",
    });
    (prisma.fileNote.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
    expect(await deleteNote("n-1", "user-1", false)).toBe(true);
    expect(prisma.fileNote.delete).toHaveBeenCalledWith({ where: { id: "n-1" } });
  });

  test("deletes when admin even if not author", async () => {
    (prisma.fileNote.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "n-1",
      authorId: "someone-else",
    });
    (prisma.fileNote.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
    expect(await deleteNote("n-1", "user-1", true)).toBe(true);
  });
});

describe("listNotesForKey", () => {
  test("queries by connectionId/bucket/key, ordered newest first", async () => {
    (prisma.fileNote.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listNotesForKey("conn-1", "my-bucket", "file.txt");
    expect(prisma.fileNote.findMany).toHaveBeenCalledWith({
      where: { connectionId: "conn-1", bucket: "my-bucket", key: "file.txt" },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("countNotesForKeys", () => {
  test("returns an empty map when keys is empty (no DB call)", async () => {
    const result = await countNotesForKeys("conn-1", "my-bucket", []);
    expect(result.size).toBe(0);
    expect(prisma.fileNote.groupBy).not.toHaveBeenCalled();
  });

  test("returns a Map<key,count> from groupBy results", async () => {
    (prisma.fileNote.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { key: "a.txt", _count: { _all: 2 } },
      { key: "b.txt", _count: { _all: 1 } },
    ]);
    const result = await countNotesForKeys("conn-1", "my-bucket", [
      "a.txt",
      "b.txt",
      "c.txt",
    ]);
    expect(result.get("a.txt")).toBe(2);
    expect(result.get("b.txt")).toBe(1);
    expect(result.get("c.txt")).toBeUndefined();
  });
});
