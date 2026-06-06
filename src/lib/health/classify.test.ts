// src/lib/health/classify.test.ts
import { describe, test, expect } from "vitest";
import { classifyError } from "./classify";

describe("classifyError", () => {
  test("AccessDenied → denied", () => {
    expect(classifyError({ name: "AccessDenied" })).toEqual({
      result: "denied",
      errorCode: "AccessDenied",
    });
  });

  test("Forbidden → denied", () => {
    expect(classifyError({ name: "Forbidden" })).toEqual({
      result: "denied",
      errorCode: "Forbidden",
    });
  });

  test("HTTP 403 with no name → denied", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 403 } })).toEqual({
      result: "denied",
      errorCode: "Forbidden",
    });
  });

  test("NoSuchKey → granted", () => {
    expect(classifyError({ name: "NoSuchKey" })).toEqual({
      result: "granted",
      errorCode: "NoSuchKey",
    });
  });

  test("NoSuchBucket → granted", () => {
    expect(classifyError({ name: "NoSuchBucket" })).toEqual({
      result: "granted",
      errorCode: "NoSuchBucket",
    });
  });

  test("NotFound → granted", () => {
    expect(classifyError({ name: "NotFound" })).toEqual({
      result: "granted",
      errorCode: "NotFound",
    });
  });

  test("PreconditionFailed → granted", () => {
    expect(classifyError({ name: "PreconditionFailed" })).toEqual({
      result: "granted",
      errorCode: "PreconditionFailed",
    });
  });

  test("HTTP 412 → granted", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 412 } })).toEqual({
      result: "granted",
      errorCode: "PreconditionFailed",
    });
  });

  test("BadDigest → granted (used by put-object probe)", () => {
    expect(classifyError({ name: "BadDigest" })).toEqual({
      result: "granted",
      errorCode: "BadDigest",
    });
  });

  test("InvalidDigest → granted", () => {
    expect(classifyError({ name: "InvalidDigest" })).toEqual({
      result: "granted",
      errorCode: "InvalidDigest",
    });
  });

  test("NotImplemented → unsupported", () => {
    expect(classifyError({ name: "NotImplemented" })).toEqual({
      result: "unsupported",
      errorCode: "NotImplemented",
    });
  });

  test("HTTP 501 → unsupported", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 501 } })).toEqual({
      result: "unsupported",
      errorCode: "NotImplemented",
    });
  });

  test("TimeoutError → error/timeout", () => {
    expect(classifyError({ name: "TimeoutError" })).toEqual({
      result: "error",
      errorCode: "timeout",
    });
  });

  test("NetworkingError → error/network", () => {
    expect(classifyError({ name: "NetworkingError" })).toEqual({
      result: "error",
      errorCode: "network",
    });
  });

  test("ECONNREFUSED → error/network", () => {
    expect(classifyError({ name: "ECONNREFUSED" })).toEqual({
      result: "error",
      errorCode: "network",
    });
  });

  test("ENOTFOUND → error/network", () => {
    expect(classifyError({ name: "ENOTFOUND" })).toEqual({
      result: "error",
      errorCode: "network",
    });
  });

  test("null → error/unknown", () => {
    expect(classifyError(null)).toEqual({
      result: "error",
      errorCode: "unknown",
    });
  });

  test("undefined → error/unknown", () => {
    expect(classifyError(undefined)).toEqual({
      result: "error",
      errorCode: "unknown",
    });
  });

  test("plain object with no name → error with status fallback", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 400 } })).toEqual({
      result: "error",
      errorCode: "status:400",
    });
  });

  test("unexpected 5xx → error/server", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 503 } })).toEqual({
      result: "error",
      errorCode: "status:503",
    });
  });

  test("falls back to .Code when .name is missing (legacy SDK)", () => {
    expect(classifyError({ Code: "AccessDenied" })).toEqual({
      result: "denied",
      errorCode: "AccessDenied",
    });
  });
});
