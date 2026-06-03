import { describe, test, expect } from "vitest";
import { applyRenamePattern } from "./bulk-rename";

describe("applyRenamePattern", () => {
  describe("prefix pattern", () => {
    test("adds prefix before file stem, preserving extension", () => {
      const result = applyRenamePattern(["photos/a.jpg"], { kind: "prefix", text: "new-" });
      expect(result[0]).toEqual({ oldKey: "photos/a.jpg", newKey: "photos/new-a.jpg", changed: true });
    });

    test("adds prefix before folder name", () => {
      const result = applyRenamePattern(["photos/sub/"], { kind: "prefix", text: "new-" });
      expect(result[0]).toEqual({ oldKey: "photos/sub/", newKey: "photos/new-sub/", changed: true });
    });

    test("marks unchanged when prefix is empty string", () => {
      const result = applyRenamePattern(["a.jpg"], { kind: "prefix", text: "" });
      expect(result[0].changed).toBe(false);
    });

    test("handles root-level file (no parent path)", () => {
      const result = applyRenamePattern(["file.txt"], { kind: "prefix", text: "pre-" });
      expect(result[0]).toEqual({ oldKey: "file.txt", newKey: "pre-file.txt", changed: true });
    });

    test("handles multiple files", () => {
      const result = applyRenamePattern(["a.jpg", "b.jpg", "sub/"], { kind: "prefix", text: "new-" });
      expect(result).toEqual([
        { oldKey: "a.jpg", newKey: "new-a.jpg", changed: true },
        { oldKey: "b.jpg", newKey: "new-b.jpg", changed: true },
        { oldKey: "sub/", newKey: "new-sub/", changed: true },
      ]);
    });
  });

  describe("suffix pattern", () => {
    test("adds suffix before extension", () => {
      const result = applyRenamePattern(["photo.jpg"], { kind: "suffix", text: "-copy" });
      expect(result[0]).toEqual({ oldKey: "photo.jpg", newKey: "photo-copy.jpg", changed: true });
    });

    test("adds suffix after folder name (no extension)", () => {
      const result = applyRenamePattern(["docs/"], { kind: "suffix", text: "-old" });
      expect(result[0]).toEqual({ oldKey: "docs/", newKey: "docs-old/", changed: true });
    });

    test("handles file with no extension", () => {
      const result = applyRenamePattern(["Makefile"], { kind: "suffix", text: "-bak" });
      expect(result[0]).toEqual({ oldKey: "Makefile", newKey: "Makefile-bak", changed: true });
    });
  });

  describe("find-replace pattern", () => {
    test("replaces substring in file stem", () => {
      const result = applyRenamePattern(
        ["report-2024.pdf"],
        { kind: "find-replace", find: "2024", replace: "2025", matchCase: true }
      );
      expect(result[0]).toEqual({ oldKey: "report-2024.pdf", newKey: "report-2025.pdf", changed: true });
    });

    test("is case-insensitive when matchCase is false", () => {
      const result = applyRenamePattern(
        ["PHOTO.jpg"],
        { kind: "find-replace", find: "photo", replace: "image", matchCase: false }
      );
      expect(result[0]).toEqual({ oldKey: "PHOTO.jpg", newKey: "image.jpg", changed: true });
    });

    test("is case-sensitive when matchCase is true", () => {
      const result = applyRenamePattern(
        ["PHOTO.jpg"],
        { kind: "find-replace", find: "photo", replace: "image", matchCase: true }
      );
      expect(result[0].changed).toBe(false);
    });

    test("marks unchanged when find string not present", () => {
      const result = applyRenamePattern(
        ["file.txt"],
        { kind: "find-replace", find: "xyz", replace: "abc", matchCase: true }
      );
      expect(result[0].changed).toBe(false);
    });

    test("marks unchanged when find string is empty", () => {
      const result = applyRenamePattern(
        ["file.txt"],
        { kind: "find-replace", find: "", replace: "abc", matchCase: true }
      );
      expect(result[0].changed).toBe(false);
    });

    test("escapes special regex characters in find string", () => {
      const result = applyRenamePattern(
        ["file.(1).txt"],
        { kind: "find-replace", find: ".(1)", replace: "-v1", matchCase: true }
      );
      expect(result[0]).toEqual({ oldKey: "file.(1).txt", newKey: "file-v1.txt", changed: true });
    });
  });

  describe("sequence pattern", () => {
    test("renames files to baseName+number with padded index", () => {
      const result = applyRenamePattern(
        ["a.jpg", "b.jpg", "c.jpg"],
        { kind: "sequence", baseName: "photo-", startAt: 1, padTo: 3 }
      );
      expect(result).toEqual([
        { oldKey: "a.jpg", newKey: "photo-001.jpg", changed: true },
        { oldKey: "b.jpg", newKey: "photo-002.jpg", changed: true },
        { oldKey: "c.jpg", newKey: "photo-003.jpg", changed: true },
      ]);
    });

    test("uses startAt offset for numbering", () => {
      const result = applyRenamePattern(
        ["x.png"],
        { kind: "sequence", baseName: "img-", startAt: 5, padTo: 2 }
      );
      expect(result[0]).toEqual({ oldKey: "x.png", newKey: "img-05.png", changed: true });
    });

    test("renames folders using sequence with no extension", () => {
      const result = applyRenamePattern(
        ["old/"],
        { kind: "sequence", baseName: "folder-", startAt: 1, padTo: 2 }
      );
      expect(result[0]).toEqual({ oldKey: "old/", newKey: "folder-01/", changed: true });
    });

    test("preserves parent path for files in subdirectories", () => {
      const result = applyRenamePattern(
        ["gallery/a.jpg"],
        { kind: "sequence", baseName: "photo-", startAt: 1, padTo: 3 }
      );
      expect(result[0]).toEqual({ oldKey: "gallery/a.jpg", newKey: "gallery/photo-001.jpg", changed: true });
    });
  });

  describe("edge cases", () => {
    test("file with dot at start (hidden file, no extension)", () => {
      const result = applyRenamePattern([".gitignore"], { kind: "prefix", text: "my-" });
      expect(result[0]).toEqual({ oldKey: ".gitignore", newKey: "my-.gitignore", changed: true });
    });

    test("returns empty array for empty input", () => {
      const result = applyRenamePattern([], { kind: "prefix", text: "x" });
      expect(result).toEqual([]);
    });
  });
});
