// src/lib/health/classify.ts
import type { ProbeResult } from "./probe";

const GRANTED_ERROR_NAMES = new Set([
  "NoSuchKey",
  "NoSuchBucket",
  "NotFound",
  "PreconditionFailed",
  "BadDigest",
  "InvalidDigest",
]);

const DENIED_ERROR_NAMES = new Set(["AccessDenied", "Forbidden"]);

const NETWORK_ERROR_NAMES = new Set([
  "NetworkingError",
  "ECONNREFUSED",
  "ENOTFOUND",
]);

export function classifyError(
  err: unknown,
): { result: ProbeResult; errorCode: string } {
  if (!err || typeof err !== "object") {
    return { result: "error", errorCode: "unknown" };
  }

  const e = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e.$metadata?.httpStatusCode;
  const name = e.name ?? e.Code ?? "";

  if (GRANTED_ERROR_NAMES.has(name)) {
    return { result: "granted", errorCode: name };
  }
  if (status === 412) {
    return { result: "granted", errorCode: "PreconditionFailed" };
  }

  if (DENIED_ERROR_NAMES.has(name) || status === 403) {
    return { result: "denied", errorCode: name || "Forbidden" };
  }

  if (name === "NotImplemented" || status === 501) {
    return { result: "unsupported", errorCode: "NotImplemented" };
  }

  if (name === "TimeoutError") {
    return { result: "error", errorCode: "timeout" };
  }

  if (NETWORK_ERROR_NAMES.has(name)) {
    return { result: "error", errorCode: "network" };
  }

  if (status !== undefined) {
    return { result: "error", errorCode: `status:${status}` };
  }

  return { result: "error", errorCode: name || "unknown" };
}
