import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    bookmark: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/connections", () => ({
  getConnectionAccessById: vi.fn().mockResolvedValue({ id: "conn-1" }),
}));

import prisma from "@/lib/db/prisma";
import { getConnectionAccessById } from "@/lib/db/connections";
import { reorderBookmarks, listBookmarks } from "./bookmarks";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reorderBookmarks", () => {
  test("runs a transaction setting sortOrder to the array index", async () => {
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "bm-a", userId: "u1" },
      { id: "bm-b", userId: "u1" },
      { id: "bm-c", userId: "u1" },
    ]);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await reorderBookmarks("u1", ["bm-c", "bm-a", "bm-b"]);

    expect(result).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    const calls: unknown[] = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calls).toHaveLength(3);
  });

  test("passes sortOrder indices matching the provided order", async () => {
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "bm-a", userId: "u1" },
      { id: "bm-b", userId: "u1" },
    ]);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.bookmark.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await reorderBookmarks("u1", ["bm-b", "bm-a"]);

    expect(prisma.bookmark.update).toHaveBeenCalledWith({
      where: { id: "bm-b" },
      data: { sortOrder: 0 },
    });
    expect(prisma.bookmark.update).toHaveBeenCalledWith({
      where: { id: "bm-a" },
      data: { sortOrder: 1 },
    });
  });

  test("returns false when any ID does not belong to the user", async () => {
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "bm-a", userId: "u1" },
      { id: "bm-b", userId: "u1" },
    ]);

    const result = await reorderBookmarks("u1", ["bm-a", "bm-b", "bm-foreign"]);

    expect(result).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("returns false for empty ids array", async () => {
    const result = await reorderBookmarks("u1", []);

    expect(result).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("listBookmarks", () => {
  const makeBookmark = (id: string, connectionId: string, bucket: string, name: string | null, endpoint: string) => ({
    id,
    connectionId,
    bucket,
    prefix: null as string | null,
    label: null as string | null,
    sortOrder: 0,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    userId: "u1",
    connection: { name, endpoint },
  });

  test("calls getConnectionAccessById once per unique connection, not once per bookmark", async () => {
    // Three bookmarks: bm-1 and bm-2 share conn-A, bm-3 uses conn-B
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeBookmark("bm-1", "conn-A", "bucket1", "My Conn A", "https://s3.example.com"),
      makeBookmark("bm-2", "conn-A", "bucket2", "My Conn A", "https://s3.example.com"),
      makeBookmark("bm-3", "conn-B", "bucket3", "My Conn B", "https://minio.example.com"),
    ]);
    (getConnectionAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "some-conn" });

    await listBookmarks("u1");

    // Only 2 unique connections → should call exactly twice
    expect(getConnectionAccessById).toHaveBeenCalledTimes(2);
  });

  test("excludes bookmarks whose connection resolves to null access", async () => {
    // conn-A has access, conn-B does not
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeBookmark("bm-1", "conn-A", "bucket1", "Conn A", "https://s3.example.com"),
      makeBookmark("bm-2", "conn-A", "bucket2", "Conn A", "https://s3.example.com"),
      makeBookmark("bm-3", "conn-B", "bucket3", "Conn B", "https://minio.example.com"),
    ]);
    (getConnectionAccessById as ReturnType<typeof vi.fn>).mockImplementation(
      async (cid: string) => (cid === "conn-A" ? { id: "conn-A" } : null)
    );

    const result = await listBookmarks("u1");

    // Only bm-1 and bm-2 should be returned (conn-B has no access)
    expect(result).toHaveLength(2);
    expect(result.map((bm) => bm.id)).toEqual(["bm-1", "bm-2"]);
  });

  test("uses connectionName fallback: name if present, else endpoint", async () => {
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      // Has a name → should use name
      makeBookmark("bm-1", "conn-A", "bucket1", "Named Connection", "https://s3.example.com"),
      // name is null → should fall back to endpoint
      makeBookmark("bm-2", "conn-B", "bucket2", null, "https://minio.example.com"),
    ]);
    (getConnectionAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "some-conn" });

    const result = await listBookmarks("u1");

    expect(result).toHaveLength(2);
    expect(result[0].connectionName).toBe("Named Connection");
    expect(result[1].connectionName).toBe("https://minio.example.com");
  });

  test("returns empty array when all bookmarks have no access", async () => {
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeBookmark("bm-1", "conn-A", "bucket1", "Conn A", "https://s3.example.com"),
    ]);
    (getConnectionAccessById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await listBookmarks("u1");

    expect(result).toHaveLength(0);
  });

  test("returns empty array when there are no bookmarks", async () => {
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getConnectionAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "some-conn" });

    const result = await listBookmarks("u1");

    expect(result).toHaveLength(0);
    expect(getConnectionAccessById).not.toHaveBeenCalled();
  });

  test("returned objects carry expected shape with createdAt as ISO string", async () => {
    const createdAt = new Date("2024-06-15T12:00:00.000Z");
    (prisma.bookmark.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "bm-1",
        connectionId: "conn-A",
        bucket: "my-bucket",
        prefix: "some/prefix/",
        label: "My Label",
        sortOrder: 0,
        createdAt,
        userId: "u1",
        connection: { name: "Conn A", endpoint: "https://s3.example.com" },
      },
    ]);
    (getConnectionAccessById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "conn-A" });

    const result = await listBookmarks("u1");

    expect(result[0]).toEqual({
      id: "bm-1",
      connectionId: "conn-A",
      connectionName: "Conn A",
      bucket: "my-bucket",
      prefix: "some/prefix/",
      label: "My Label",
      createdAt: "2024-06-15T12:00:00.000Z",
    });
  });
});
