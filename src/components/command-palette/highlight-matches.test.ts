import { describe, test, expect } from "vitest";
import { splitForHighlight } from "./highlight-matches";

describe("splitForHighlight", () => {
  test("empty query returns text as single non-match segment", () => {
    expect(splitForHighlight("hello world", "")).toEqual([
      { text: "hello world", match: false },
    ]);
  });
  test("single token match", () => {
    expect(splitForHighlight("hello world", "world")).toEqual([
      { text: "hello ", match: false },
      { text: "world", match: true },
    ]);
  });
  test("case insensitive", () => {
    expect(splitForHighlight("Hello World", "world")).toEqual([
      { text: "Hello ", match: false },
      { text: "World", match: true },
    ]);
  });
  test("multiple tokens both matched", () => {
    expect(splitForHighlight("logo design draft", "logo draft")).toEqual([
      { text: "logo", match: true },
      { text: " design ", match: false },
      { text: "draft", match: true },
    ]);
  });
  test("query token not present is ignored", () => {
    expect(splitForHighlight("hello world", "xyz")).toEqual([
      { text: "hello world", match: false },
    ]);
  });
  test("overlapping/duplicate matches preserved cleanly", () => {
    expect(splitForHighlight("aaa", "aa")).toEqual([
      { text: "aa", match: true },
      { text: "a", match: false },
    ]);
  });
});
