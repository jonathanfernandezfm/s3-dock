"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";
import { useInvalidateActivity } from "./activity";
import type { IncompleteUpload } from "@/types/s3";

export interface AbortResult {
  key: string;
  uploadId: string;
  success: boolean;
  error?: string;
}

async function fetchIncompleteUploads(
  connectionId: string,
  bucket: string
): Promise<IncompleteUpload[]> {
  const response = await fetch(
    `/api/buckets/${encodeURIComponent(bucket)}/multipart-uploads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to load incomplete uploads");
  }
  return response.json();
}

async function abortUploads(
  connectionId: string,
  bucket: string,
  uploads: Array<{ key: string; uploadId: string }>
): Promise<{ results: AbortResult[] }> {
  const response = await fetch(
    `/api/buckets/${encodeURIComponent(bucket)}/multipart-uploads`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, uploads }),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to abort uploads");
  }
  return response.json();
}

export function useIncompleteUploads(connectionId: string, bucket: string) {
  return useQuery({
    queryKey: queryKeys.multipartUploads.byBucket(connectionId, bucket),
    queryFn: () => fetchIncompleteUploads(connectionId, bucket),
    enabled: !!connectionId && !!bucket,
  });
}

export function useAbortUploads(connectionId: string, bucket: string) {
  const queryClient = useQueryClient();
  const invalidateActivity = useInvalidateActivity();

  return useMutation({
    mutationFn: (uploads: Array<{ key: string; uploadId: string }>) =>
      abortUploads(connectionId, bucket, uploads),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.multipartUploads.byBucket(connectionId, bucket),
      });
      invalidateActivity();
    },
  });
}
