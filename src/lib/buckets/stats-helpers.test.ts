import { describe, test, expect } from "vitest";
import {
  emptyAccumulator,
  accumulateObjectStats,
  summarizeStorageClasses,
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
