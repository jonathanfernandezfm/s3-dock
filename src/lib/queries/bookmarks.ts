"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";
import type { BookmarkResponse } from "@/lib/bookmarks-helpers";
import { getBucketBookmarks, getPrefixBookmarks } from "@/lib/bookmarks-helpers";

async function fetchBookmarks(): Promise<BookmarkResponse[]> {
  const response = await fetch("/api/bookmarks");
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch bookmarks");
  }
  return response.json();
}

async function createBookmarkFn(data: {
  connectionId: string;
  bucket: string;
  prefix?: string | null;
}): Promise<BookmarkResponse> {
  const response = await fetch("/api/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create bookmark");
  }
  return response.json();
}

async function deleteBookmarkFn(id: string): Promise<void> {
  const response = await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete bookmark");
  }
}

export function useBookmarks() {
  return useQuery({
    queryKey: queryKeys.bookmarks.all,
    queryFn: fetchBookmarks,
    staleTime: 60_000,
  });
}

export function useBookmarksForBucket(connectionId: string, bucket: string): BookmarkResponse[] {
  const { data } = useBookmarks();
  return useMemo(
    () => getPrefixBookmarks(data ?? [], connectionId, bucket),
    [data, connectionId, bucket]
  );
}

export function useBookmarksForConnection(connectionId: string): BookmarkResponse[] {
  const { data } = useBookmarks();
  return useMemo(
    () => getBucketBookmarks(data ?? [], connectionId),
    [data, connectionId]
  );
}

export function useCreateBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBookmarkFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
    },
  });
}

export function useDeleteBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteBookmarkFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks.all });
    },
  });
}
