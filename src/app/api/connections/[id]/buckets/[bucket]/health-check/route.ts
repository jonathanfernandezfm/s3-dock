// src/app/api/connections/[id]/buckets/[bucket]/health-check/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import prisma from "@/lib/db/prisma";
import { runBucketHealthCheck } from "@/lib/health/runner";
import { buildCapabilities } from "@/lib/health/rollup";
import {
  STALENESS_THRESHOLD_MS,
  type HealthReport,
  type ProbeResult,
  type ProbeResultRecord,
} from "@/lib/health/probe";
import { BUCKET_PROBES } from "@/lib/health/registry";

type RouteContext = { params: Promise<{ id: string; bucket: string }> };

async function readPersisted(
  connectionId: string,
  bucket: string,
): Promise<HealthReport | null> {
  const row = await prisma.bucketHealthCheck.findUnique({
    where: { connectionId_bucket: { connectionId, bucket } },
    include: { probes: true },
  });
  if (!row) return null;

  const records: ProbeResultRecord[] = row.probes.map((p) => {
    const probe = BUCKET_PROBES.find((bp) => bp.key === p.probeKey);
    return {
      key: p.probeKey,
      capability: probe?.capability ?? "browse-objects",
      required: probe?.required ?? true,
      result: p.result as ProbeResult,
      errorCode: p.errorCode ?? undefined,
      durationMs: p.durationMs,
    };
  });

  return {
    scope: "bucket",
    connectionId,
    bucket,
    checkedAt: row.checkedAt.toISOString(),
    isStale: Date.now() - row.checkedAt.getTime() > STALENESS_THRESHOLD_MS,
    durationMs: row.durationMs,
    connectivity: row.connectivity as HealthReport["connectivity"],
    capabilities: buildCapabilities("bucket", records),
  };
}

export const GET = withAuth<RouteContext>(
  async (_req, { user, params }) => {
    const { id, bucket } = params;
    const access = await getConnectionAccessById(id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const report = await readPersisted(id, bucket);
    if (!report) {
      return NextResponse.json({ error: "not_run" }, { status: 404 });
    }
    return NextResponse.json(report);
  },
);

export const POST = withAuth<RouteContext>(
  async (_req, { user, params }) => {
    const { id, bucket } = params;
    const access = await getConnectionAccessById(id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const report = await runBucketHealthCheck(id, bucket);
      const status = report.connectivity === "unreachable" ? 502 : 200;
      return NextResponse.json(report, { status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
);
