import { describe, test, expect, beforeEach } from "vitest";
import { checkUnlockRateLimit, resetUnlockRateLimit } from "./rate-limit";

beforeEach(() => resetUnlockRateLimit());

describe("checkUnlockRateLimit", () => {
  test("allows first 5 attempts per ip+slug", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkUnlockRateLimit("1.2.3.4", "abc12345")).toBe(true);
    }
  });

  test("blocks the 6th attempt within the window", () => {
    for (let i = 0; i < 5; i++) checkUnlockRateLimit("1.2.3.4", "abc12345");
    expect(checkUnlockRateLimit("1.2.3.4", "abc12345")).toBe(false);
  });

  test("different ip+slug pairs are isolated", () => {
    for (let i = 0; i < 5; i++) checkUnlockRateLimit("1.2.3.4", "abc12345");
    expect(checkUnlockRateLimit("9.9.9.9", "abc12345")).toBe(true);
    expect(checkUnlockRateLimit("1.2.3.4", "different")).toBe(true);
  });
});
