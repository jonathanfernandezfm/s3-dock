import { describe, test, expect } from "vitest";
import { canAccessFeature } from "./gates";

describe("canAccessFeature", () => {
  test("FREE cannot access shareLinks", () => {
    expect(canAccessFeature("FREE", "shareLinks")).toBe(false);
  });

  test("FREE cannot access teams", () => {
    expect(canAccessFeature("FREE", "teams")).toBe(false);
  });

  test("PRO can access shareLinks", () => {
    expect(canAccessFeature("PRO", "shareLinks")).toBe(true);
  });

  test("PRO can access teams", () => {
    expect(canAccessFeature("PRO", "teams")).toBe(true);
  });

  test("ENTERPRISE can access shareLinks", () => {
    expect(canAccessFeature("ENTERPRISE", "shareLinks")).toBe(true);
  });

  test("ENTERPRISE can access teams", () => {
    expect(canAccessFeature("ENTERPRISE", "teams")).toBe(true);
  });
});
