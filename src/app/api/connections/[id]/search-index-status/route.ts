import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import { getConnectionAccessById } from "@/lib/db/connections";
import { isSearchIndexEnabled } from "@/lib/search/feature-flag";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAuth<RouteContext>(async (_req, { user, params }) => {
  const { id } = params;

  if (!isSearchIndexEnabled()) {
    return NextResponse.json({ state: "disabled" });
  }

  const access = await getConnectionAccessById(id, user.id);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tier = user.subscription?.tier ?? "FREE";
  if (tier === "FREE") {
    return NextResponse.json({ state: "disabled" });
  }

  const [indexed, latestJob] = await Promise.all([
    prisma.objectIndex.count({ where: { connectionId: id } }),
    prisma.crawlJob.findFirst({
      where: { connectionId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!latestJob) {
    return NextResponse.json({ state: "none" });
  }
  if (latestJob.status === "RUNNING" || latestJob.status === "PENDING") {
    return NextResponse.json({ state: "indexing", indexed });
  }
  if (latestJob.status === "PARTIAL_LIMIT_HIT") {
    return NextResponse.json({ state: "partial", indexed });
  }
  if (latestJob.status === "FAILED") {
    return NextResponse.json({ state: "failed", message: latestJob.errorMessage ?? "Unknown error" });
  }
  return NextResponse.json({
    state: "ready",
    indexed,
    lastReconciledAt: latestJob.completedAt?.toISOString() ?? null,
  });
});
