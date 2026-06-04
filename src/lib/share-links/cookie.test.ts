import { describe, test, expect, beforeAll } from "vitest";
import { signUnlockCookie, verifyUnlockCookie, COOKIE_TTL_SECONDS } from "./cookie";

beforeAll(() => {
  process.env.SHARE_LINK_COOKIE_SECRET = "a".repeat(64);
});

describe("unlock cookie", () => {
  test("sign + verify round-trip succeeds", async () => {
    const token = await signUnlockCookie("abc12345");
    const slug = await verifyUnlockCookie(token);
    expect(slug).toBe("abc12345");
  });

  test("verify returns null for tampered token", async () => {
    const token = await signUnlockCookie("abc12345");
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifyUnlockCookie(tampered)).toBeNull();
  });

  test("verify returns null for token signed with different secret", async () => {
    const token = await signUnlockCookie("abc12345");
    process.env.SHARE_LINK_COOKIE_SECRET = "b".repeat(64);
    expect(await verifyUnlockCookie(token)).toBeNull();
    process.env.SHARE_LINK_COOKIE_SECRET = "a".repeat(64);
  });

  test("COOKIE_TTL_SECONDS is 30 minutes", () => {
    expect(COOKIE_TTL_SECONDS).toBe(30 * 60);
  });
});
