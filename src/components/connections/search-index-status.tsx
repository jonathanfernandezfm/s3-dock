"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

type Status =
  | { state: "indexing"; indexed: number }
  | { state: "ready"; indexed: number; lastReconciledAt: string | null }
  | { state: "partial"; indexed: number }
  | { state: "failed"; message: string }
  | { state: "disabled" }
  | { state: "none" };

export function SearchIndexStatus({ connectionId }: { connectionId: string }) {
  const { data } = useQuery<Status>({
    queryKey: ["search-index-status", connectionId],
    queryFn: async () => {
      const res = await fetch(`/api/connections/${connectionId}/search-index-status`);
      if (!res.ok) return { state: "disabled" } as Status;
      return res.json();
    },
    refetchInterval: (q) =>
      q.state.data?.state === "indexing" ? 5_000 : false,
    staleTime: 10_000,
  });

  if (!data || data.state === "disabled" || data.state === "none") return null;

  const label =
    data.state === "indexing"
      ? `Indexing… ${data.indexed.toLocaleString()} objects`
      : data.state === "partial"
      ? `Partial index (${data.indexed.toLocaleString()}) — 2M cap reached`
      : data.state === "failed"
      ? `Index error: ${data.message}`
      : `Indexed ${data.indexed.toLocaleString()} objects`;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Search className="h-3 w-3" />
      <span>{label}</span>
    </div>
  );
}
