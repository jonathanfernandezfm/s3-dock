import { describe, test, expect } from "vitest";
import { computeStatus, type StatusInputs } from "./status";

const base: StatusInputs = {
  revokedAt: null,
  expiresAt: null,
  maxUses: null,
  useCount: 0,
};

describe("computeStatus", () => {
  test("active when nothing is set", () => {
    expect(computeStatus(base, new Date())).toBe("active");
  });

  test("revoked when revokedAt set", () => {
    expect(
      computeStatus({ ...base, revokedAt: new Date() }, new Date())
    ).toBe("revoked");
  });

  test("expired when expiresAt is in the past", () => {
    expect(
      computeStatus(
        { ...base, expiresAt: new Date("2026-01-01") },
        new Date("2026-06-04")
      )
    ).toBe("expired");
  });

  test("active when expiresAt is in the future", () => {
    expect(
      computeStatus(
        { ...base, expiresAt: new Date("2026-12-31") },
        new Date("2026-06-04")
      )
    ).toBe("active");
  });

  test("exhausted when useCount >= maxUses", () => {
    expect(
      computeStatus({ ...base, maxUses: 5, useCount: 5 }, new Date())
    ).toBe("exhausted");
  });

  test("active when useCount < maxUses", () => {
    expect(
      computeStatus({ ...base, maxUses: 5, useCount: 4 }, new Date())
    ).toBe("active");
  });

  test("revoked beats expired", () => {
    expect(
      computeStatus(
        {
          ...base,
          revokedAt: new Date("2026-06-04"),
          expiresAt: new Date("2026-01-01"),
        },
        new Date("2026-06-04")
      )
    ).toBe("revoked");
  });
});
