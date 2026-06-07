// src/lib/health/observe.ts
//
// Records "observed" probe results that we can't safely probe directly.
// CreateBucket is the canonical example — calling it during a health
// check would create a real bucket, so we instead watch live calls in
// the API route and write the result into the same probe table the
// runner uses. The runner skips writes for probes whose result is
// "skipped", so observations are preserved across health check refreshes.

import prisma from "@/lib/db/prisma";
import type { ProbeResult } from "./probe";

export async function recordConnectionProbeObservation(
  connectionId: string,
  probeKey: string,
  result: ProbeResult,
  errorCode: string | null = null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.connectionHealthCheck.findUnique({
      where: { connectionId },
      select: { id: true },
    });
    const healthCheckId = existing
      ? existing.id
      : (
          await tx.connectionHealthCheck.create({
            data: {
              connectionId,
              checkedAt: new Date(),
              durationMs: 0,
              connectivity: "ok",
            },
            select: { id: true },
          })
        ).id;

    await tx.connectionPermissionCheck.upsert({
      where: { healthCheckId_probeKey: { healthCheckId, probeKey } },
      create: {
        healthCheckId,
        probeKey,
        result,
        errorCode,
        durationMs: 0,
      },
      update: { result, errorCode, durationMs: 0 },
    });
  });
}
