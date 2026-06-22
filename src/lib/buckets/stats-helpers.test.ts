import { describe, test, expect } from "vitest";
import {
  emptyAccumulator,
  accumulateObjectStats,
  summarizeStorageClasses,
  extensionOf,
  summarizeExtensions,
  LARGEST_N,
} from "./stats-helpers";

describe("emptyAccumulator", () => {
  test("returns zero count, zero size, empty map", () => {
    const acc = emptyAccumulator();
    expect(acc.count).toBe(0);
    expect(acc.size).toBe(0);
    expect(acc.byClass.size).toBe(0);
  });
});

describe("accumulateObjectStats", () => {
  test("leaves the accumulator unchanged when given no entries", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, []);
    expect(result.count).toBe(0);
    expect(result.size).toBe(0);
    expect(result.byClass.size).toBe(0);
  });

  test("sums multiple objects of the same storage class", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, [
      { Size: 100, StorageClass: "STANDARD" },
      { Size: 250, StorageClass: "STANDARD" },
    ]);
    expect(result.count).toBe(2);
    expect(result.size).toBe(350);
    expect(result.byClass.get("STANDARD")).toEqual({ count: 2, size: 350 });
  });

  test("separates entries by storage class", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, [
      { Size: 100, StorageClass: "STANDARD" },
      { Size: 200, StorageClass: "STANDARD_IA" },
      { Size: 50, StorageClass: "STANDARD" },
    ]);
    expect(result.count).toBe(3);
    expect(result.size).toBe(350);
    expect(result.byClass.get("STANDARD")).toEqual({ count: 2, size: 150 });
    expect(result.byClass.get("STANDARD_IA")).toEqual({ count: 1, size: 200 });
  });

  test("treats Size: undefined as 0", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, [
      { Size: undefined, StorageClass: "STANDARD" },
    ]);
    expect(result.count).toBe(1);
    expect(result.size).toBe(0);
    expect(result.byClass.get("STANDARD")).toEqual({ count: 1, size: 0 });
  });

  test("treats StorageClass: undefined as STANDARD", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, [
      { Size: 100, StorageClass: undefined },
    ]);
    expect(result.byClass.get("STANDARD")).toEqual({ count: 1, size: 100 });
  });

  test("accumulator carries state across multiple calls", () => {
    let acc = emptyAccumulator();
    acc = accumulateObjectStats(acc, [{ Size: 100, StorageClass: "STANDARD" }]);
    acc = accumulateObjectStats(acc, [{ Size: 50, StorageClass: "STANDARD" }]);
    expect(acc.count).toBe(2);
    expect(acc.size).toBe(150);
    expect(acc.byClass.get("STANDARD")).toEqual({ count: 2, size: 150 });
  });
});

describe("summarizeStorageClasses", () => {
  test("returns an empty array when the map is empty", () => {
    expect(summarizeStorageClasses(new Map())).toEqual([]);
  });

  test("returns entries sorted by size descending", () => {
    const map = new Map([
      ["STANDARD_IA", { count: 1, size: 100 }],
      ["STANDARD", { count: 2, size: 500 }],
      ["GLACIER", { count: 3, size: 250 }],
    ]);
    expect(summarizeStorageClasses(map)).toEqual([
      { class: "STANDARD", count: 2, size: 500 },
      { class: "GLACIER", count: 3, size: 250 },
      { class: "STANDARD_IA", count: 1, size: 100 },
    ]);
  });
});

describe("extensionOf", () => {
  test("lowercases the extension", () => {
    expect(extensionOf("a/photo.JPG")).toBe("jpg");
  });

  test("handles nested key with extension", () => {
    expect(extensionOf("a/b/c/doc.pdf")).toBe("pdf");
  });

  test("returns (none) for extensionless key", () => {
    expect(extensionOf("a/README")).toBe("(none)");
  });

  test("returns (none) for dotfile (dot at position 0 of name)", () => {
    expect(extensionOf("a/.env")).toBe("(none)");
  });

  test("returns (none) for folder marker key ending in /", () => {
    expect(extensionOf("a/sub/")).toBe("(none)");
  });

  test("returns last extension for double extension", () => {
    expect(extensionOf("a/x.tar.gz")).toBe("gz");
  });

  test("handles key with no directory component", () => {
    expect(extensionOf("file.txt")).toBe("txt");
  });
});

describe("emptyAccumulator (new fields)", () => {
  test("byExtension starts empty and largest starts empty", () => {
    const acc = emptyAccumulator();
    expect(acc.byExtension.size).toBe(0);
    expect(acc.largest.length).toBe(0);
  });
});

describe("accumulateObjectStats with Key field", () => {
  test("groups by extension and sums sizes", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, [
      { Key: "a/photo.jpg", Size: 100, StorageClass: "STANDARD" },
      { Key: "b/other.jpg", Size: 200, StorageClass: "STANDARD" },
      { Key: "c/doc.pdf", Size: 50, StorageClass: "STANDARD" },
    ]);
    expect(result.byExtension.get("jpg")).toEqual({ count: 2, size: 300 });
    expect(result.byExtension.get("pdf")).toEqual({ count: 1, size: 50 });
  });

  test("entries without Key fall into (none) extension", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, [
      { Size: 100, StorageClass: "STANDARD" },
    ]);
    expect(result.byExtension.get("(none)")).toEqual({ count: 1, size: 100 });
  });

  test("entries without Key are not tracked in largest", () => {
    const acc = emptyAccumulator();
    const result = accumulateObjectStats(acc, [
      { Size: 999, StorageClass: "STANDARD" },
    ]);
    expect(result.largest.length).toBe(0);
  });
});

describe("largest tracking", () => {
  test("tracks top LARGEST_N by size; given 12 objects sizes 1..12, keeps top 10 sorted desc", () => {
    const acc = emptyAccumulator();
    const contents = Array.from({ length: 12 }, (_, i) => ({
      Key: `file${i + 1}.txt`,
      Size: i + 1,
      StorageClass: "STANDARD",
    }));
    const result = accumulateObjectStats(acc, contents);
    expect(result.largest.length).toBe(LARGEST_N);
    // Must be sorted descending
    for (let i = 0; i < result.largest.length - 1; i++) {
      expect(result.largest[i].size).toBeGreaterThanOrEqual(result.largest[i + 1].size);
    }
    // Smallest two (size 1 and 2) must be excluded
    const sizes = result.largest.map((o) => o.size);
    expect(sizes).not.toContain(1);
    expect(sizes).not.toContain(2);
    // Largest must be 12
    expect(result.largest[0].size).toBe(12);
  });

  test("ties don't crash and are all retained up to LARGEST_N", () => {
    const acc = emptyAccumulator();
    const contents = Array.from({ length: LARGEST_N + 2 }, (_, i) => ({
      Key: `file${i}.txt`,
      Size: 100,
      StorageClass: "STANDARD",
    }));
    expect(() => accumulateObjectStats(acc, contents)).not.toThrow();
    const result = accumulateObjectStats(emptyAccumulator(), contents);
    expect(result.largest.length).toBe(LARGEST_N);
  });
});

describe("summarizeExtensions", () => {
  test("returns empty array for empty map", () => {
    expect(summarizeExtensions(new Map())).toEqual([]);
  });

  test("returns entries sorted by size descending", () => {
    const map = new Map([
      ["pdf", { count: 1, size: 500 }],
      ["jpg", { count: 5, size: 1200 }],
      ["txt", { count: 2, size: 80 }],
    ]);
    const result = summarizeExtensions(map);
    expect(result[0]).toEqual({ ext: "jpg", count: 5, size: 1200 });
    expect(result[1]).toEqual({ ext: "pdf", count: 1, size: 500 });
    expect(result[2]).toEqual({ ext: "txt", count: 2, size: 80 });
  });
});
