import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    shareLink: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    shareLinkEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import prisma from "@/lib/db/prisma";
import {
  createShareLink,
  getShareLinkBySlug,
  listShareLinksByConnection,
  revokeShareLink,
  recordShareLinkEvent,
  atomicIncrementUseCount,
  getShareLinkWithEvents,
} from "./share-links";

beforeEach(() => vi.clearAllMocks());

describe("createShareLink", () => {
  test("creates a row with the provided fields and generated slug", async () => {
    (prisma.shareLink.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
      slug: "abc12345",
    });
    const result = await createShareLink({
      connectionId: "conn-1",
      bucket: "b",
      key: "k",
      createdById: "u-1",
      createdByDisplayName: "Alice",
      createdByImageUrl: null,
      expiresAt: null,
      passwordHash: null,
      maxUses: null,
      description: null,
    });
    expect(prisma.shareLink.create).toHaveBeenCalledOnce();
    const call = (prisma.shareLink.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.data.connectionId).toBe("conn-1");
    expect(call.data.slug).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(result.id).toBe("sl-1");
  });
});

describe("getShareLinkBySlug", () => {
  test("returns the link when found", async () => {
    (prisma.shareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
      slug: "abc12345",
    });
    const result = await getShareLinkBySlug("abc12345");
    expect(prisma.shareLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc12345" },
      include: {
        connection: {
          include: {
            workspace: {
              include: { team: true },
            },
          },
        },
      },
    });
    expect(result?.id).toBe("sl-1");
  });

  test("returns null when not found", async () => {
    (prisma.shareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await getShareLinkBySlug("missing0")).toBeNull();
  });
});

describe("listShareLinksByConnection", () => {
  test("filters by connectionId and orders by createdAt desc", async () => {
    (prisma.shareLink.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listShareLinksByConnection("conn-1");
    expect(prisma.shareLink.findMany).toHaveBeenCalledWith({
      where: { connectionId: "conn-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  test("optionally filters by bucket and key", async () => {
    (prisma.shareLink.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listShareLinksByConnection("conn-1", { bucket: "b", key: "k" });
    expect(prisma.shareLink.findMany).toHaveBeenCalledWith({
      where: { connectionId: "conn-1", bucket: "b", key: "k" },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("revokeShareLink", () => {
  test("sets revokedAt to now", async () => {
    const before = Date.now();
    (prisma.shareLink.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
    });
    await revokeShareLink("sl-1");
    const call = (prisma.shareLink.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.where).toEqual({ id: "sl-1" });
    expect(call.data.revokedAt).toBeInstanceOf(Date);
    expect((call.data.revokedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("recordShareLinkEvent", () => {
  test("creates an event row with the provided action and headers", async () => {
    (prisma.shareLinkEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await recordShareLinkEvent({
      shareLinkId: "sl-1",
      action: "DOWNLOAD",
      ip: "1.2.3.4",
      userAgent: "Mozilla",
      referrer: null,
    });
    expect(prisma.shareLinkEvent.create).toHaveBeenCalledWith({
      data: {
        shareLinkId: "sl-1",
        action: "DOWNLOAD",
        ip: "1.2.3.4",
        userAgent: "Mozilla",
        referrer: null,
      },
    });
  });
});

describe("atomicIncrementUseCount", () => {
  test("returns true when the raw update affected a row", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      { use_count: 1 },
    ]);
    expect(await atomicIncrementUseCount("sl-1")).toBe(true);
  });

  test("returns false when no row matched (exhausted/expired/revoked)", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(await atomicIncrementUseCount("sl-1")).toBe(false);
  });
});

describe("getShareLinkWithEvents", () => {
  test("returns link with last 50 events ordered desc", async () => {
    (prisma.shareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
      events: [],
    });
    await getShareLinkWithEvents("sl-1");
    expect(prisma.shareLink.findUnique).toHaveBeenCalledWith({
      where: { id: "sl-1" },
      include: {
        events: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
  });
});
