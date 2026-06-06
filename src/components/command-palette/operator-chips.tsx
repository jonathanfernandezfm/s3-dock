import { X } from "lucide-react";
import type { ParsedQueryEcho } from "@/lib/queries/search";

type Chip = { key: string; label: string };

function buildChips(parsed: ParsedQueryEcho): Chip[] {
  const chips: Chip[] = [];
  if (parsed.mime) chips.push({ key: "mime", label: `mime: ${parsed.mime}` });
  if (parsed.ext) chips.push({ key: "ext", label: `ext: ${parsed.ext}` });
  if (parsed.sizeMin) chips.push({ key: "sizeMin", label: `size ≥ ${parsed.sizeMin}` });
  if (parsed.sizeMax) chips.push({ key: "sizeMax", label: `size ≤ ${parsed.sizeMax}` });
  if (parsed.before) chips.push({ key: "before", label: `before: ${parsed.before.slice(0, 10)}` });
  if (parsed.after) chips.push({ key: "after", label: `after: ${parsed.after.slice(0, 10)}` });
  if (parsed.bucket) chips.push({ key: "in", label: `in: ${parsed.bucket}` });
  if (parsed.connection) chips.push({ key: "connection", label: `connection: ${parsed.connection}` });
  if (parsed.tag) chips.push({ key: "tag", label: `tag: ${parsed.tag}` });
  return chips;
}

export function OperatorChips({
  parsed,
  query,
  onQueryChange,
}: {
  parsed: ParsedQueryEcho;
  query: string;
  onQueryChange: (next: string) => void;
}) {
  const chips = buildChips(parsed);
  if (chips.length === 0) return null;

  const removeChip = (key: string) => {
    // Strip the corresponding operator token from the raw query string.
    const opMap: Record<string, RegExp> = {
      mime: /\bmime:\S+/i,
      ext: /\bext:\S+/i,
      sizeMin: /\bsize:>=?\S+/i,
      sizeMax: /\bsize:<=?\S+/i,
      before: /\bbefore:\S+/i,
      after: /\bafter:\S+/i,
      in: /\bin:\S+/i,
      connection: /\bconnection:("[^"]+"|\S+)/i,
      tag: /\btag:\S+/i,
    };
    const re = opMap[key];
    if (!re) return;
    onQueryChange(query.replace(re, "").replace(/\s+/g, " ").trim());
  };

  return (
    <div className="flex flex-wrap gap-1 px-3 pb-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => removeChip(c.key)}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted-foreground/10"
        >
          {c.label}
          <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}
