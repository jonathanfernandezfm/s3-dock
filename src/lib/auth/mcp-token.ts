import { randomBytes, createHash } from "crypto";
import prisma from "@/lib/db/prisma";
import type { AuthUser } from "./clerk";
import type { McpToken } from "@/generated/prisma/client";

export const TOKEN_PREFIX = "s3dock_pat_";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Issue a new personal access token for the given user.
 * The raw token is returned exactly once — it is never stored.
 */
export async function issueMcpToken(
  userId: string,
  name: string,
  opts?: { expiresAt?: Date }
): Promise<{ token: string; record: McpToken }> {
  const secret = randomBytes(32).toString("base64url");
  const raw = TOKEN_PREFIX + secret;
  const tokenHash = sha256Hex(raw);
  const prefix = raw.slice(0, 12);

  const record = await prisma.mcpToken.create({
    data: {
      userId,
      name,
      tokenHash,
      prefix,
      expiresAt: opts?.expiresAt,
    },
  });

  return { token: raw, record };
}

/**
 * Resolve a raw personal access token to its owner (AuthUser).
 * Returns null if the token is invalid, revoked, or expired.
 * Best-effort updates lastUsedAt without blocking.
 */
export async function resolveMcpToken(rawToken: string): Promise<AuthUser | null> {
  if (!rawToken?.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const tokenHash = sha256Hex(rawToken);

  const record = await prisma.mcpToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: { subscription: true },
      },
    },
  });

  if (!record) {
    return null;
  }

  if (record.revokedAt != null) {
    return null;
  }

  if (record.expiresAt != null && record.expiresAt < new Date()) {
    return null;
  }

  // Best-effort touch last-used — do not await-block on it failing
  prisma.mcpToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return record.user;
}
