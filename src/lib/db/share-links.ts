import prisma from "@/lib/db/prisma";
import type { ShareLink, ShareLinkEvent } from "@/generated/prisma/client";
import type { ShareLinkEventAction } from "@/generated/prisma/client";
import { generateSlug } from "@/lib/share-links/slug";

export type CreateShareLinkInput = {
  connectionId: string;
  bucket: string;
  key: string;
  createdById: string;
  createdByDisplayName: string;
  createdByImageUrl: string | null;
  expiresAt: Date | null;
  passwordHash: string | null;
  maxUses: number | null;
  description: string | null;
};

export async function createShareLink(
  input: CreateShareLinkInput
): Promise<ShareLink> {
  return prisma.shareLink.create({
    data: {
      slug: generateSlug(),
      connectionId: input.connectionId,
      bucket: input.bucket,
      key: input.key,
      createdById: input.createdById,
      createdByDisplayName: input.createdByDisplayName,
      createdByImageUrl: input.createdByImageUrl,
      expiresAt: input.expiresAt,
      passwordHash: input.passwordHash,
      maxUses: input.maxUses,
      description: input.description,
    },
  });
}

export async function getShareLinkBySlug(slug: string) {
  return prisma.shareLink.findUnique({
    where: { slug },
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
}

export type ListFilter = {
  bucket?: string;
  key?: string;
};

export async function listShareLinksByConnection(
  connectionId: string,
  filter: ListFilter = {}
): Promise<ShareLink[]> {
  return prisma.shareLink.findMany({
    where: {
      connectionId,
      ...(filter.bucket ? { bucket: filter.bucket } : {}),
      ...(filter.key ? { key: filter.key } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeShareLink(id: string): Promise<ShareLink> {
  return prisma.shareLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export type RecordEventInput = {
  shareLinkId: string;
  action: ShareLinkEventAction;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
};

export async function recordShareLinkEvent(
  input: RecordEventInput
): Promise<ShareLinkEvent> {
  return prisma.shareLinkEvent.create({
    data: {
      shareLinkId: input.shareLinkId,
      action: input.action,
      ip: input.ip,
      userAgent: input.userAgent,
      referrer: input.referrer,
    },
  });
}

export async function atomicIncrementUseCount(id: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ useCount: number }>>`
    UPDATE share_links
    SET "useCount" = "useCount" + 1
    WHERE id = ${id}
      AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      AND ("maxUses" IS NULL OR "useCount" < "maxUses")
    RETURNING "useCount"
  `;
  return rows.length > 0;
}

export async function getShareLinkWithEvents(id: string) {
  return prisma.shareLink.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
}

export async function getShareLinkById(id: string) {
  return prisma.shareLink.findUnique({
    where: { id },
    include: { connection: true },
  });
}

export type EditShareLinkInput = {
  expiresAt?: Date | null;
  passwordHash?: string | null;
  maxUses?: number | null;
  description?: string | null;
};

export async function editShareLink(
  id: string,
  input: EditShareLinkInput
): Promise<ShareLink> {
  return prisma.shareLink.update({
    where: { id },
    data: input,
  });
}

export async function getActiveShareCountsForKeys(
  connectionId: string,
  bucket: string,
  keys: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (keys.length === 0) return result;

  const now = new Date();
  const links = await prisma.shareLink.findMany({
    where: {
      connectionId,
      bucket,
      key: { in: keys },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { key: true, maxUses: true, useCount: true },
  });

  for (const link of links) {
    if (link.maxUses !== null && link.useCount >= link.maxUses) continue;
    result.set(link.key, (result.get(link.key) ?? 0) + 1);
  }
  return result;
}
