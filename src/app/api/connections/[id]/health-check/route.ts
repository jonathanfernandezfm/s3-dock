// src/app/api/connections/[id]/health-check/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import prisma from "@/lib/db/prisma";
import { runConnectionHealthCheck } from "@/lib/health/runner";
import { buildCapabilities } from "@/lib/health/rollup";
import {
  STALENESS_THRESHOLD_MS,
  type HealthReport,
  type ProbeResult,
  type ProbeResultRecord,
} from "@/lib/health/probe";
import { CONNECTION_PROBES } from "@/lib/health/registry";

type RouteContext = { params: Promise<{ id: string }> };

async function readPersisted(connectionId: string): Promise<HealthReport | null> {
  const row = await prisma.connectionHealthCheck.findUnique({
    where: { connectionId },
    include: { probes: true },
  });
  if (!row) return null;

  const records: ProbeResultRecord[] = row.probes.map((p) => {
    const probe = CONNECTION_PROBES.find((cp) => cp.key === p.probeKey);
    return {
      key: p.probeKey,
      capability: probe?.capability ?? "browse-buckets",
      required: probe?.required ?? true,
      result: p.result as ProbeResult,
      errorCode: p.errorCode ?? undefined,
      durationMs: p.durationMs,
    };
  });

  return {
    scope: "connection",
    connectionId,
    checkedAt: row.checkedAt.toISOString(),
    isStale: Date.now() - row.checkedAt.getTime() > STALENESS_THRESHOLD_MS,
    durationMs: row.durationMs,
    connectivity: row.connectivity as HealthReport["connectivity"],
    capabilities: buildCapabilities("connection", records),
  };
}

export const GET = withAuth<RouteContext>(
  async (_req, { user, params }) => {
    const { id } = params;
    const access = await getConnectionAccessById(id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const report = await readPersisted(id);
    if (!report) {
      return NextResponse.json({ error: "not_run" }, { status: 404 });
    }
    return NextResponse.json(report);
  },
);

export const POST = withAuth<RouteContext>(
  async (_req, { user, params }) => {
    const { id } = params;
    const access = await getConnectionAccessById(id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only admins can run a health check" },
        { status: 403 },
      );
    }

    try {
      const report = await runConnectionHealthCheck(id);
      const status = report.connectivity === "unreachable" ? 502 : 200;
      return NextResponse.json(report, { status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
);
