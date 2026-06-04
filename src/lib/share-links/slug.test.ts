import { describe, test, expect } from "vitest";
import { generateSlug, SLUG_ALPHABET, SLUG_LENGTH } from "./slug";

describe("generateSlug", () => {
  test("produces a string of SLUG_LENGTH characters", () => {
    expect(generateSlug()).toHaveLength(SLUG_LENGTH);
  });

  test("only contains base62 characters", () => {
    const re = new RegExp(`^[${SLUG_ALPHABET}]+$`);
    for (let i = 0; i < 100; i++) {
      expect(generateSlug()).toMatch(re);
    }
  });

  test("returns different slugs across calls (uniqueness sanity)", () => {
    const slugs = new Set(Array.from({ length: 1000 }, () => generateSlug()));
    expect(slugs.size).toBe(1000);
  });
});
