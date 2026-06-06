import { describe, test, expect } from "vitest";
import { parseSearchQuery } from "./query";

describe("parseSearchQuery", () => {
  test("plain text becomes freeText", () => {
    const q = parseSearchQuery("invoice march");
    expect(q.freeText).toBe("invoice march");
  });

  test("mime group", () => {
    const q = parseSearchQuery("invoice mime:image");
    expect(q.freeText).toBe("invoice");
    expect(q.mime).toBe("image");
  });

  test("mime exact", () => {
    const q = parseSearchQuery("mime:image/png logo");
    expect(q.mime).toBe("image/png");
    expect(q.freeText).toBe("logo");
  });

  test("ext", () => {
    const q = parseSearchQuery("ext:pdf");
    expect(q.ext).toBe("pdf");
    expect(q.freeText).toBe("");
  });

  test("size greater than with mb unit", () => {
    const q = parseSearchQuery("size:>10mb");
    expect(q.sizeMin).toBe(10n * 1024n * 1024n + 1n);
    expect(q.sizeMax).toBeUndefined();
  });

  test("size less than with kb", () => {
    const q = parseSearchQuery("size:<100kb");
    expect(q.sizeMax).toBe(100n * 1024n - 1n);
    expect(q.sizeMin).toBeUndefined();
  });

  test("size >= gb", () => {
    const q = parseSearchQuery("size:>=2gb");
    expect(q.sizeMin).toBe(2n * 1024n * 1024n * 1024n);
  });

  test("before iso", () => {
    const q = parseSearchQuery("before:2026-01-15");
    expect(q.before).toEqual(new Date("2026-01-15T00:00:00.000Z"));
  });

  test("after relative 7d", () => {
    const now = new Date("2026-06-05T12:00:00Z");
    const q = parseSearchQuery("after:7d", { now });
    const expected = new Date("2026-05-29T12:00:00Z");
    expect(q.after?.getTime()).toBe(expected.getTime());
  });

  test("in bucket", () => {
    const q = parseSearchQuery("in:logs-prod report");
    expect(q.bucket).toBe("logs-prod");
    expect(q.freeText).toBe("report");
  });

  test("connection with quoted name", () => {
    const q = parseSearchQuery('connection:"prod aws" foo');
    expect(q.connection).toBe("prod aws");
    expect(q.freeText).toBe("foo");
  });

  test("tag", () => {
    const q = parseSearchQuery("tag:invoice receipt");
    expect(q.tag).toBe("invoice");
    expect(q.freeText).toBe("receipt");
  });

  test("multiple operators combine", () => {
    const q = parseSearchQuery("mime:pdf size:>1mb after:2026-01-01 invoice");
    expect(q.mime).toBe("pdf");
    expect(q.sizeMin).toBe(1n * 1024n * 1024n + 1n);
    expect(q.after).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(q.freeText).toBe("invoice");
  });

  test("unknown operator falls through to freeText", () => {
    const q = parseSearchQuery("version:1.2.3 release");
    expect(q.freeText).toBe("version:1.2.3 release");
  });

  test("empty input", () => {
    const q = parseSearchQuery("");
    expect(q.freeText).toBe("");
  });

  test("only operators leaves empty freeText", () => {
    const q = parseSearchQuery("mime:image ext:png");
    expect(q.freeText).toBe("");
    expect(q.mime).toBe("image");
    expect(q.ext).toBe("png");
  });
});
