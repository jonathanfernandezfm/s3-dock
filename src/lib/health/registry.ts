// src/lib/health/registry.ts
import { CONNECTION_PROBES } from "./probes/connection";
import { BUCKET_PROBES } from "./probes/bucket";
import type { Probe, ProbeScope } from "./probe";

export { CONNECTION_PROBES, BUCKET_PROBES };

export function probesForScope(scope: ProbeScope): Probe[] {
  return scope === "connection" ? CONNECTION_PROBES : BUCKET_PROBES;
}
