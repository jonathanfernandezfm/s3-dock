import { describe, test, expect } from "vitest";
import { canManageFiles, canManageConnections } from "./roles";

describe("canManageFiles", () => {
  test("allows ADMIN and EDITOR", () => {
    expect(canManageFiles("ADMIN")).toBe(true);
    expect(canManageFiles("EDITOR")).toBe(true);
  });

  test("denies VIEWER, null, and undefined", () => {
    expect(canManageFiles("VIEWER")).toBe(false);
    expect(canManageFiles(null)).toBe(false);
    expect(canManageFiles(undefined)).toBe(false);
  });
});

describe("canManageConnections", () => {
  test("allows only ADMIN", () => {
    expect(canManageConnections("ADMIN")).toBe(true);
    expect(canManageConnections("EDITOR")).toBe(false);
    expect(canManageConnections("VIEWER")).toBe(false);
    expect(canManageConnections(null)).toBe(false);
    expect(canManageConnections(undefined)).toBe(false);
  });
});
