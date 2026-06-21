import { describe, test, expect } from "vitest";
import { isLikelyMetadata } from "./metadata-filter";

describe("isLikelyMetadata", () => {
  test("UUID json under meta/ → true (both signals)", () => {
    expect(isLikelyMetadata("meta/c8914a29-c310-45b1-9dc4-90affba68647.json")).toBe(true);
  });

  test("bare UUID at root → true", () => {
    expect(isLikelyMetadata("c8914a29-c310-45b1-9dc4-90affba68647.json")).toBe(true);
  });

  test("file under metadata/ → true", () => {
    expect(isLikelyMetadata("metadata/notes.txt")).toBe(true);
  });

  test("normal asset → false", () => {
    expect(isLikelyMetadata("images/buildings/tower.png")).toBe(false);
  });

  test("file that contains 'meta' in name but not as a segment → false", () => {
    expect(isLikelyMetadata("images/metallic-tower.png")).toBe(false);
  });

  test("nested _meta segment → true", () => {
    expect(isLikelyMetadata("a/_meta/x.json")).toBe(true);
  });
});
