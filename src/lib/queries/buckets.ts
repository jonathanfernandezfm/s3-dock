"use client";

import { useMutation, useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import { useConnections, type ConnectionResponse } from "./connections";
import { queryKeys } from "./keys";
import { useInvalidateActivity } from "./activity";
import type { S3Bucket } from "@/types";
import type { S3BucketVersioning } from "@/types/s3";

async function fetchBuckets(connectionId: string): Promise<S3Bucket[]> {
  const response = await fetch("/api/buckets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch buckets");
  }

  const buckets = await response.json();
  return buckets.map((bucket: Omit<S3Bucket, "connectionId">) => ({
    ...bucket,
    connectionId,
  }));
}

async function createBucket(
  connectionId: string,
  name: string
): Promise<{ success: boolean }> {
  const response = await fetch("/api/buckets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId, name }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create bucket");
  }

  return response.json();
}

async function deleteBucket(
  connectionId: string,
  name: string
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/buckets/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete bucket");
  }

  return response.json();
}

export function useBuckets(connectionId: string) {
  return useQuery({
    queryKey: queryKeys.buckets.byConnection(connectionId),
    queryFn: () => fetchBuckets(connectionId),
    enabled: !!connectionId,
  });
}

export interface BucketGroup {
  connection: ConnectionResponse;
  buckets: S3Bucket[];
  isLoading: boolean;
  error: Error | null;
}

export function useAllBuckets(): {
  groups: BucketGroup[];
  isLoading: boolean;
  hasAnyConnections: boolean;
} {
  const { data: connections = [], isLoading: isConnectionsLoading } = useConnections();

  const queries = useQueries({
    queries: connections.map((connection) => ({
      queryKey: queryKeys.buckets.byConnection(connection.id),
      queryFn: () => fetchBuckets(connection.id),
      enabled: true,
    })),
  });

  const groups: BucketGroup[] = connections.map((connection, index) => ({
    connection,
    buckets: queries[index]?.data || [],
    isLoading: queries[index]?.isLoading || false,
    error: queries[index]?.error as Error | null,
  }));

  const isLoading = isConnectionsLoading || queries.some((q) => q.isLoading);
  const hasAnyConnections = connections.length > 0;

  return { groups, isLoading, hasAnyConnections };
}

export function useCreateBucket(connectionId: string) {
  const queryClient = useQueryClient();
  const invalidateActivity = useInvalidateActivity();

  return useMutation({
    mutationFn: (name: string) => createBucket(connectionId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.buckets.all });
      invalidateActivity();
    },
  });
}

export function useDeleteBucket(connectionId: string) {
  const queryClient = useQueryClient();
  const invalidateActivity = useInvalidateActivity();

  return useMutation({
    mutationFn: (name: string) => deleteBucket(connectionId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.buckets.all });
      invalidateActivity();
    },
  });
}

async function fetchBucketVersioning(
  connectionId: string,
  bucket: string,
): Promise<S3BucketVersioning> {
  const url = `/api/buckets/${encodeURIComponent(bucket)}/versioning?connectionId=${encodeURIComponent(connectionId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch bucket versioning");
  }
  return res.json();
}

async function setBucketVersioning(
  connectionId: string,
  bucket: string,
  enabled: boolean,
): Promise<{ success: true; status: "Enabled" | "Suspended" }> {
  const res = await fetch(`/api/buckets/${encodeURIComponent(bucket)}/versioning`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId, enabled }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update bucket versioning");
  }
  return res.json();
}

export function useBucketVersioning(connectionId: string, bucket: string) {
  return useQuery({
    queryKey: queryKeys.bucketVersioning.status(connectionId, bucket),
    queryFn: () => fetchBucketVersioning(connectionId, bucket),
    enabled: !!connectionId && !!bucket,
  });
}

export function useSetBucketVersioning(connectionId: string, bucket: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setBucketVersioning(connectionId, bucket, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.bucketVersioning.status(connectionId, bucket),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.versions.all });
    },
  });
}

export interface BucketStats {
  objectCount: number;
  totalSize: number;
  storageClasses: Array<{ class: string; count: number; size: number }>;
}

async function fetchBucketStats(
  connectionId: string,
  bucket: string,
): Promise<BucketStats> {
  const res = await fetch(
    `/api/buckets/${encodeURIComponent(bucket)}/stats`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch bucket stats");
  }
  return res.json();
}

export function useBucketStats(connectionId: string, bucket: string) {
  return useQuery({
    queryKey: queryKeys.bucketStats.byBucket(connectionId, bucket),
    queryFn: () => fetchBucketStats(connectionId, bucket),
    enabled: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}
