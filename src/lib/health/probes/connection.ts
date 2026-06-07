// src/lib/health/probes/connection.ts
import {
  DeleteBucketCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import { classifyError } from "../classify";
import type { Probe, ProbeRunOutcome } from "../probe";

function elapsed(start: number): number {
  return Math.max(0, performance.now() - start);
}

const listBuckets: Probe = {
  key: "list-buckets",
  capability: "browse-buckets",
  scope: "connection",
  required: true,
  async run({ client }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(new ListBucketsCommand({}));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const deleteBucket: Probe = {
  key: "delete-bucket",
  capability: "delete-buckets",
  scope: "connection",
  required: true,
  async run({ client, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    const probeBucketName = `s3client-healthcheck-${randomKey.split("-").pop() ?? "nonexistent"}`;
    try {
      await client.send(new DeleteBucketCommand({ Bucket: probeBucketName }));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

// Observed, not probed: actually calling CreateBucket would create a real
// bucket as a side effect. The result is recorded by PUT /api/buckets.
const createBucket: Probe = {
  key: "create-bucket",
  capability: "create-buckets",
  scope: "connection",
  required: true,
  async run(): Promise<ProbeRunOutcome> {
    return { result: "skipped", durationMs: 0 };
  },
};

export const CONNECTION_PROBES: Probe[] = [listBuckets, deleteBucket, createBucket];
