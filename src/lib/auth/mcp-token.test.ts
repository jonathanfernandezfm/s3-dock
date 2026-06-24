import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    mcpToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from "@/lib/db/prisma";
import { issueMcpToken, resolveMcpToken, TOKEN_PREFIX } from "./mcp-token";

beforeEach(() => {
  vi.clearAllMocks();
});

const mockSubscription = { id: "sub-1", userId: "u1", tier: "FREE" };
const mockUser = { id: "u1", clerkId: "clerk_u1", email: "test@example.com", subscription: mockSubscription };

const mockRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "tok-1",
  userId: "u1",
  name: "test-token",
  tokenHash: "fakehash",
  prefix: "s3dock_pat_",
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: new Date(),
  user: mockUser,
  ...overrides,
});

describe("issueMcpToken", () => {
  test("returns a raw token with TOKEN_PREFIX and a persisted record", async () => {
    const record = mockRecord();
    (prisma.mcpToken.create as ReturnType<typeof vi.fn>).mockResolvedValue(record);

    const result = await issueMcpToken("u1", "test-token");

    expect(result.token).toMatch(new RegExp(`^${TOKEN_PREFIX}`));
    expect(result.record).toBe(record);
    expect(prisma.mcpToken.create).toHaveBeenCalledOnce();
  });

  test("two issued tokens have different tokenHash and prefix", async () => {
    let callCount = 0;
    (prisma.mcpToken.create as ReturnType<typeof vi.fn>).mockImplementation((args: { data: { tokenHash: string; prefix: string } }) => {
      callCount++;
      return Promise.resolve(mockRecord({ id: `tok-${callCount}`, tokenHash: args.data.tokenHash, prefix: args.data.prefix }));
    });

    const r1 = await issueMcpToken("u1", "token-a");
    const r2 = await issueMcpToken("u1", "token-b");

    expect(r1.token).not.toBe(r2.token);
    expect(r1.record.tokenHash).not.toBe(r2.record.tokenHash);
    expect(r1.record.prefix).not.toBe(r2.record.prefix);
  });
});

describe("resolveMcpToken", () => {
  test("a freshly issued token resolves to its user with subscription included", async () => {
    (prisma.mcpToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecord());
    (prisma.mcpToken.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const user = await resolveMcpToken(`${TOKEN_PREFIX}somevalidtoken`);

    expect(user).not.toBeNull();
    expect(user?.id).toBe("u1");
    expect(user?.subscription).toBeDefined();
    expect(prisma.mcpToken.findUnique).toHaveBeenCalledOnce();
  });

  test("a token not starting with TOKEN_PREFIX resolves to null without a DB call", async () => {
    const user = await resolveMcpToken("invalid_prefix_token");

    expect(user).toBeNull();
    expect(prisma.mcpToken.findUnique).not.toHaveBeenCalled();
  });

  test("a revoked token (revokedAt set) resolves to null", async () => {
    (prisma.mcpToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRecord({ revokedAt: new Date("2026-01-01") })
    );

    const user = await resolveMcpToken(`${TOKEN_PREFIX}sometoken`);

    expect(user).toBeNull();
  });

  test("an expired token (expiresAt in the past) resolves to null", async () => {
    (prisma.mcpToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRecord({ expiresAt: new Date("2020-01-01") })
    );

    const user = await resolveMcpToken(`${TOKEN_PREFIX}sometoken`);

    expect(user).toBeNull();
  });

  test("an unknown token (no DB record) resolves to null", async () => {
    (prisma.mcpToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const user = await resolveMcpToken(`${TOKEN_PREFIX}unknowntoken`);

    expect(user).toBeNull();
  });
});
