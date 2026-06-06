"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "./keys";
import { useTier } from "@/hooks/use-tier";

export type ParsedQueryEcho = {
  freeText: string;
  mime?: string;
  ext?: string;
  sizeMin?: string;
  sizeMax?: string;
  before?: string;
  after?: string;
  bucket?: string;
  connection?: string;
  tag?: string;
};

export type SearchResult = {
  id: string;
  workspaceId: string;
  connectionId: string;
  connectionName: string | null;
  endpoint: string;
  bucket: string;
  key: string;
  size: string;
  lastModified: string;
  mime: string | null;
  extension: string | null;
  tags: unknown;
  score: number;
  href: string;
};

export type SearchResponse = {
  results: SearchResult[];
  parsedQuery: ParsedQueryEcho;
  partial: boolean;
};

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useGlobalSearch(query: string) {
  const { tier } = useTier();
  const debounced = useDebouncedValue(query, 100);

  return useQuery<SearchResponse>({
    queryKey: queryKeys.search.query(debounced),
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(debounced)}`);
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      return res.json();
    },
    enabled: (tier === "PRO" || tier === "ENTERPRISE") && debounced.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 0,
  });
}
