import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { createS3Client } from "@/lib/s3/client";
import { decrypt } from "@/lib/crypto";
import { listBuckets } from "@/lib/search/crawl/buckets";
import { runCrawlTick, type CrawlState } from "@/lib/search/crawl/walk";
import { sweepStaleRows } from "@/lib/search/crawl/sweep";
import { isSearchIndexEnabled } from "@/lib/search/feature-flag";

const HARD_CAP = 2_000_000;
const MAX_PAGES_PER_TICK = 50;
const MAX_MS_PER_TICK = 50_000;

function checkInternalAuth(req: NextRequest): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) return false;
  return req.headers.get("x-internal-token") === token;
}

async function refireSelf(jobId: string, baseUrl: string): Promise<void> {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) return;
  // Fire-and-forget: do not await.
  fetch(`${baseUrl}/api/internal/crawl?jobId=${jobId}`, {
    method: "POST",
    headers: { "x-internal-token": token },
  }).catch((err) => {
    console.error("[search-index] self-refire failed", { jobId, err });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSearchIndexEnabled()) {
    return NextResponse.json({ error: "Disabled" }, { status: 404 });
  }
  if (!checkInternalAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }

  const job = await prisma.crawlJob.findUnique({
    where: { id: jobId },
    include: { connection: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status === "COMPLETED" || job.status === "PARTIAL_LIMIT_HIT" || job.status === "FAILED") {
    return NextResponse.json({ ok: true, terminal: true });
  }

  const now = new Date();
  await prisma.crawlJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      startedAt: job.startedAt ?? now,
      lastTickAt: now,
    },
  });

  // Build the S3 client.
  const connection = {
    ...job.connection,
    secretAccessKey: decrypt(job.connection.secretAccessKey),
  };
  const client = createS3Client({
    endpoint: connection.endpoint,
    region: connection.region,
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
    forcePathStyle: connection.forcePathStyle,
  });

  // Initialize bucket list on first tick.
  let state: CrawlState = {
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    currentBucket: job.currentBucket,
    bucketsRemaining: job.bucketsRemaining,
    nextContinuationToken: job.nextContinuationToken,
    objectsIndexed: job.objectsIndexed,
  };

  if (state.currentBucket === null && state.bucketsRemaining.length === 0) {
    try {
      const all = await listBuckets(client);
      state = { ...state, currentBucket: all[0] ?? null, bucketsRemaining: all.slice(1) };
    } catch (err) {
      await prisma.crawlJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage: `Failed to list buckets: ${err instanceof Error ? err.message : "unknown"}`,
          completedAt: new Date(),
        },
      });
      return NextResponse.json({ ok: false, error: "list-buckets-failed" });
    }
  }

  let result;
  try {
    result = await runCrawlTick(client, state, {
      now: () => Date.now(),
      maxPages: MAX_PAGES_PER_TICK,
      maxMs: MAX_MS_PER_TICK,
      hardCap: HARD_CAP,
    });
  } catch (err) {
    await prisma.crawlJob.update({
      where: { id: jobId },
      data: { lastTickAt: new Date(), errorMessage: err instanceof Error ? err.message : "tick error" },
    });
    return NextResponse.json({ ok: false, error: "tick-error" });
  }

  // Persist checkpoint.
  await prisma.crawlJob.update({
    where: { id: jobId },
    data: {
      currentBucket: result.state.currentBucket,
      bucketsRemaining: result.state.bucketsRemaining,
      nextContinuationToken: result.state.nextContinuationToken,
      objectsIndexed: result.state.objectsIndexed,
      lastTickAt: new Date(),
    },
  });

  if (result.partialLimitHit) {
    await prisma.crawlJob.update({
      where: { id: jobId },
      data: { status: "PARTIAL_LIMIT_HIT", completedAt: new Date() },
    });
    return NextResponse.json({ ok: true, status: "PARTIAL_LIMIT_HIT" });
  }

  if (result.done) {
    if (job.kind === "RECONCILE" && job.startedAt) {
      await sweepStaleRows(connection.id, job.startedAt);
    }
    await prisma.crawlJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({ ok: true, status: "COMPLETED" });
  }

  // More work to do — refire.
  await refireSelf(jobId, req.nextUrl.origin);
  return NextResponse.json({ ok: true, status: "RUNNING" });
}
