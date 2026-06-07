"use client";

import { Search } from "lucide-react";
import { useSearchIndexStatus } from "@/lib/queries/search-index";

export function SearchIndexStatus({ connectionId }: { connectionId: string }) {
  const { data } = useSearchIndexStatus(connectionId);

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
