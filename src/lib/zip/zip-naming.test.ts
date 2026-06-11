import { describe, it, expect } from "vitest";
import {
  zipEntryName,
  zipDownloadName,
  sanitizeZipFilename,
} from "./zip-naming";

describe("zipEntryName", () => {
  it("strips the root prefix so the zip mirrors the visible folder", () => {
    expect(zipEntryName("photos/2024/cat.jpg", "photos/")).toBe("2024/cat.jpg");
  });

  it("keeps the full key when there is no root prefix (bucket root)", () => {
    expect(zipEntryName("cat.jpg", "")).toBe("cat.jpg");
  });

  it("falls back to the full key when it does not start with the prefix", () => {
    expect(zipEntryName("other/cat.jpg", "photos/")).toBe("other/cat.jpg");
  });

  it("never returns a leading slash", () => {
    expect(zipEntryName("/weird/key.txt", "")).toBe("weird/key.txt");
  });
});

describe("zipDownloadName", () => {
  it("names the zip after the folder when a single folder is selected", () => {
    expect(zipDownloadName(["photos/2024/"], "my-bucket", "photos/")).toBe(
      "2024.zip"
    );
  });

  it("names the zip after the current folder for multi-selections", () => {
    expect(
      zipDownloadName(["photos/a.jpg", "photos/b.jpg"], "my-bucket", "photos/")
    ).toBe("photos.zip");
  });

  it("falls back to the bucket name at bucket root", () => {
    expect(zipDownloadName(["a.jpg", "b.jpg"], "my-bucket", "")).toBe(
      "my-bucket.zip"
    );
  });
});

describe("sanitizeZipFilename", () => {
  it("replaces characters that are invalid in filenames", () => {
    expect(sanitizeZipFilename('a/b\\c:d*e?f"g<h>i|j.zip')).toBe(
      "a_b_c_d_e_f_g_h_i_j.zip"
    );
  });

  it("appends .zip when missing", () => {
    expect(sanitizeZipFilename("photos")).toBe("photos.zip");
  });

  it("falls back to download.zip for empty input", () => {
    expect(sanitizeZipFilename("")).toBe("download.zip");
  });
});
