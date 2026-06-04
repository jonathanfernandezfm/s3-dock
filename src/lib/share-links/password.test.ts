import { describe, test, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  test("hashPassword returns a bcrypt hash (not plaintext)", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  test("verifyPassword returns true for matching password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  test("verifyPassword returns false for wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("each hash uses a fresh salt", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });
});
