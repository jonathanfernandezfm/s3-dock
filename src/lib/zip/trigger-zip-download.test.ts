// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { triggerZipDownload } from "./trigger-zip-download";

describe("triggerZipDownload", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("submits a hidden form POST with the JSON payload", () => {
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(function (this: HTMLFormElement) {
        // capture form state at submit time, before the form is removed
        expect(this.method).toBe("post");
        expect(this.action).toContain("/api/objects/download-zip");
        expect(this.target).toBe("zip-download-frame");
        const input = this.querySelector(
          "input[name=payload]"
        ) as HTMLInputElement;
        expect(JSON.parse(input.value)).toEqual({
          connectionId: "conn-1",
          bucket: "bucket",
          keys: ["photos/2024/"],
          rootPrefix: "photos/",
          filename: "2024.zip",
        });
      });

    triggerZipDownload({
      connectionId: "conn-1",
      bucket: "bucket",
      keys: ["photos/2024/"],
      rootPrefix: "photos/",
      filename: "2024.zip",
    });

    expect(submit).toHaveBeenCalledTimes(1);
    // form is cleaned up, iframe persists for the response
    expect(document.querySelector("form")).toBeNull();
    expect(document.getElementById("zip-download-frame")).not.toBeNull();
  });

  it("reuses the hidden iframe across calls", () => {
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    const request = {
      connectionId: "c",
      bucket: "b",
      keys: ["a.txt"],
      rootPrefix: "",
      filename: "b.zip",
    };
    triggerZipDownload(request);
    triggerZipDownload(request);
    expect(document.querySelectorAll("iframe").length).toBe(1);
  });
});
