// src/lib/health/connectivity.test.ts
import { describe, test, expect } from "vitest";
import { deriveConnectivity } from "./connectivity";
import type { ProbeResultRecord } from "./probe";

function rec(
  result: ProbeResultRecord["result"],
  errorCode?: string,
): ProbeResultRecord {
  return {
    key: "k",
    capability: "browse-buckets",
    required: true,
    result,
    errorCode,
    durationMs: 0,
  };
}

describe("deriveConnectivity", () => {
  test("any granted result → ok", () => {
    expect(
      deriveConnectivity("connection", [rec("granted"), rec("denied")]),
    ).toBe("ok");
  });

  test("all errors with network → unreachable (connection scope)", () => {
    expect(
      deriveConnectivity("connection", [
        rec("error", "network"),
        rec("error", "timeout"),
      ]),
    ).toBe("unreachable");
  });

  test("all errors with timeout → unreachable", () => {
    expect(
      deriveConnectivity("bucket", [
        rec("error", "timeout"),
        rec("error", "timeout"),
      ]),
    ).toBe("unreachable");
  });

  test("mix of network and non-network errors → ok", () => {
    expect(
      deriveConnectivity("connection", [
        rec("error", "network"),
        rec("error", "BadRequest"),
      ]),
    ).toBe("ok");
  });

  test("bucket scope: all NoSuchBucket → missing-bucket", () => {
    expect(
      deriveConnectivity("bucket", [
        rec("granted", "NoSuchBucket"),
        rec("granted", "NoSuchBucket"),
      ]),
    ).toBe("missing-bucket");
  });

  test("bucket scope: NoSuchBucket mixed with other → ok", () => {
    expect(
      deriveConnectivity("bucket", [
        rec("granted", "NoSuchBucket"),
        rec("granted"),
      ]),
    ).toBe("ok");
  });

  test("connection scope: NoSuchBucket never produces missing-bucket", () => {
    expect(
      deriveConnectivity("connection", [
        rec("granted", "NoSuchBucket"),
        rec("granted", "NoSuchBucket"),
      ]),
    ).toBe("ok");
  });

  test("skipped probes are ignored in derivation", () => {
    expect(
      deriveConnectivity("connection", [
        rec("error", "network"),
        rec("skipped"),
      ]),
    ).toBe("unreachable");
  });

  test("empty probe list → ok", () => {
    expect(deriveConnectivity("connection", [])).toBe("ok");
  });

  test("all skipped → ok", () => {
    expect(deriveConnectivity("connection", [rec("skipped")])).toBe("ok");
  });
});
