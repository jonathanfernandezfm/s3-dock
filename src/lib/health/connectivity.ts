// src/lib/health/connectivity.ts
import type { Connectivity, ProbeResultRecord, ProbeScope } from "./probe";

export function deriveConnectivity(
  scope: ProbeScope,
  probeResults: ProbeResultRecord[],
): Connectivity {
  const nonSkipped = probeResults.filter((p) => p.result !== "skipped");
  if (nonSkipped.length === 0) return "ok";

  const allNetworkErrors = nonSkipped.every(
    (p) =>
      p.result === "error" &&
      (p.errorCode === "network" || p.errorCode === "timeout"),
  );
  if (allNetworkErrors) return "unreachable";

  if (scope === "bucket") {
    const allMissingBucket = nonSkipped.every(
      (p) => p.errorCode === "NoSuchBucket",
    );
    if (allMissingBucket) return "missing-bucket";
  }

  return "ok";
}
