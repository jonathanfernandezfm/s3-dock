# Plan 016: Demote UUID/metadata files into a separate "Metadata" group in command-palette search

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8d46baa..HEAD -- src/components/command-palette/search-results-group.tsx src/lib/search`
> `git status --short src/components/command-palette/`
> This component has **uncommitted local edits** at the time of writing (see
> "Current state"). Preserve them. If the file has changed in ways that
> conflict with the excerpts below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8d46baa`, 2026-06-21

## Why this matters

Command-palette search (⌘K) returns UUID-named JSON metadata files (e.g. `meta/c8914a29-c310-45b1-9dc4-90affba68647.json`) interleaved with real assets. Their names carry zero meaning to a user scanning results, so they're noise that pushes useful hits down the list (finding #19). This plan classifies each result as primary or "metadata/other" and renders metadata in a separate, lower-prominence **"Metadata"** group below the main results — without hiding anything. The classification is a pure, tested heuristic so it's easy to tune.

## Current state

- `src/app/api/search/route.ts` — `GET /api/search`: queries the `object_index` table, orders by `score DESC, lastModified DESC`, `LIMIT 20` (default). No path/extension exclusion. Each result has `{ id, connectionId, bucket, key, size, lastModified, mime, extension, tags, score, href, … }`.
- `src/components/command-palette/search-results-group.tsx` — renders results. Relevant block (current line numbers approximate — **the file has uncommitted local edits**, read it fresh):
  - `const results = data?.results ?? [];` (~line 96)
  - empty-state when `results.length === 0` (~lines 97-105)
  - the results `<CommandGroup heading={heading}>` mapping each `r` to a `<CommandItem>` (~lines 107-149). Each item shows an icon, a highlighted label (`basename(r.key)`), a subtitle (`connectionName · bucket/dir`), optional tag chips, and a size·time suffix.
  - `SearchResult` type comes from `@/lib/queries/search`.
- **Uncommitted local edits** present in this file (do not revert them): the loading guard was changed from `if (isLoading && !data)` to `if (isLoading)`, and in `command-palette.tsx` a `{!isFileSearch && <CommandEmpty>…}` guard was added. These are unrelated to this change; leave them intact.

### Conventions to match
- Pure helpers live under `src/lib/` with a `vitest` test (see `src/lib/bulk-rename.test.ts`).
- The component is presentational and imports `CommandGroup`, `CommandItem` from `@/components/ui/command`. A second group is just another `<CommandGroup heading="Metadata">`.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|---------------------------------------------------------|---------------------|
| Tests     | `pnpm test`                                             | all pass (≥469)     |
| One test  | `pnpm test src/lib/search/metadata-filter.test.ts`     | pass                |
| Typecheck | `pnpm exec tsc --noEmit`                               | no **new** errors   |
| Lint      | `pnpm lint`                                            | no **new** problems |

**Baselines at `8d46baa`** (pre-existing, not yours): tsc → 2 errors in `landing-page.test.tsx`; lint → 27 problems, none in this plan's files; tests → 469 pass.

## Scope

**In scope** (modify/create):
- `src/lib/search/metadata-filter.ts` (create — pure classifier)
- `src/lib/search/metadata-filter.test.ts` (create — tests)
- `src/components/command-palette/search-results-group.tsx` (partition + second group)

**Out of scope** (do NOT touch):
- `src/app/api/search/route.ts` and the indexer (`src/lib/search/index-ops.ts`) — no server/index change in this plan (see Maintenance notes for the ranking caveat).
- `src/components/command-palette/command-palette.tsx` — leave its uncommitted edit as-is; you don't need to change it.
- The `HighlightMatches`, `FileIcon`, `basename`/`dirname`/`formatBytes`/`formatTime` helpers already in the component — reuse, don't rewrite.

## Git workflow

- Branch: `advisor/016-search-metadata-group`
- Conventional commit, e.g. `feat(search): demote metadata files to a separate group`.
- Do NOT push or open a PR unless instructed. Do not stage/commit the pre-existing uncommitted edits as if they were yours — mention them if you must commit together.

## Steps

### Step 1: Pure classifier `src/lib/search/metadata-filter.ts`

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_SEGMENTS = new Set(["meta", "metadata", "_meta"]);

function basenameNoExt(key: string): string {
  const clean = key.endsWith("/") ? key.slice(0, -1) : key;
  const slash = clean.lastIndexOf("/");
  const base = slash === -1 ? clean : clean.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot); // keep dotfiles intact
}

/**
 * Heuristic: a result is "metadata/other" — low signal to a human scanning
 * results — when its basename (sans extension) is a bare UUID, or it lives
 * under a directory segment named meta/metadata/_meta.
 */
export function isLikelyMetadata(key: string): boolean {
  if (UUID_RE.test(basenameNoExt(key))) return true;
  const dirSegments = key.split("/").slice(0, -1);
  return dirSegments.some((s) => META_SEGMENTS.has(s.toLowerCase()));
}
```

**Verify**: `pnpm exec tsc --noEmit` → no new errors.

### Step 2: Tests — `src/lib/search/metadata-filter.test.ts`

Model after `src/lib/bulk-rename.test.ts`. Cover:
- UUID json → `isLikelyMetadata("meta/c8914a29-c310-45b1-9dc4-90affba68647.json")` → true (both signals)
- bare UUID at root → `isLikelyMetadata("c8914a29-c310-45b1-9dc4-90affba68647.json")` → true
- under `metadata/` → `isLikelyMetadata("metadata/notes.txt")` → true
- normal asset → `isLikelyMetadata("images/buildings/tower.png")` → false
- a normal file that merely contains "meta" in its name → `isLikelyMetadata("images/metallic-tower.png")` → false (segment match is exact, not substring)
- nested: `isLikelyMetadata("a/_meta/x.json")` → true

**Verify**: `pnpm test src/lib/search/metadata-filter.test.ts` → pass.

### Step 3: Partition results and render a second group

In `src/components/command-palette/search-results-group.tsx` (read it fresh first):
1. Add `import { isLikelyMetadata } from "@/lib/search/metadata-filter";`.
2. After `const results = data?.results ?? [];`, partition:
   ```tsx
   const primary = results.filter((r) => !isLikelyMetadata(r.key));
   const metadata = results.filter((r) => isLikelyMetadata(r.key));
   ```
   Keep the existing `if (results.length === 0) { …empty… }` check unchanged (it should consider the full `results`, not just `primary`).
3. Extract the per-result `<CommandItem>` JSX (currently inside the `.map`) into a local function inside the component so both groups reuse it, e.g.:
   ```tsx
   const renderItem = (r: SearchResult) => {
     const isFolder = r.key.endsWith("/");
     const label = basename(r.key) || r.bucket;
     const subtitle = `${r.connectionName ?? "connection"} · ${r.bucket}${dirname(r.key) ? "/" + dirname(r.key) : ""}`;
     const tagValues = Array.isArray(r.tags)
       ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string")
       : [];
     return (
       <CommandItem
         key={r.id}
         value={`${query} ${r.bucket} ${r.key} ${r.connectionName ?? ""}`}
         forceMount
         onSelect={() => (isFolder ? onSelectFolder(r) : onSelectFile(r))}
       >
         {/* …existing item body verbatim… */}
       </CommandItem>
     );
   };
   ```
   (Copy the existing item body exactly — icon span, label/HighlightMatches, tag chips, subtitle, size·time suffix. Do not change the markup.)
4. Replace the single returned group with the primary group plus a conditional metadata group:
   ```tsx
   return (
     <>
       <CommandGroup heading={heading}>
         {primary.map(renderItem)}
       </CommandGroup>
       {metadata.length > 0 && (
         <CommandGroup heading="Metadata">
           {metadata.map(renderItem)}
         </CommandGroup>
       )}
     </>
   );
   ```
   Edge case: if `primary.length === 0` but `metadata.length > 0`, the first group renders empty (just a heading) — acceptable, but prefer rendering the primary `<CommandGroup>` only when `primary.length > 0` to avoid a stray heading:
   ```tsx
   {primary.length > 0 && <CommandGroup heading={heading}>{primary.map(renderItem)}</CommandGroup>}
   ```

**Verify**: `pnpm exec tsc --noEmit` → no new errors; `grep -n 'heading="Metadata"' src/components/command-palette/search-results-group.tsx` → match.

## Test plan

- **`src/lib/search/metadata-filter.test.ts`** — the cases in Step 2 (UUID, meta dir, normal asset, substring-not-segment, nested).
- The component change is markup re-grouping with no new logic beyond `isLikelyMetadata`; no component test (no harness wired for the palette). The classifier carries all the breakable logic and is fully tested.
- Verification: `pnpm test` → all pass including the new file.

## Done criteria

ALL must hold:

- [ ] `pnpm test` exits 0; `metadata-filter.test.ts` exists and passes
- [ ] `pnpm exec tsc --noEmit` shows only the 2 pre-existing `landing-page.test.tsx` errors
- [ ] `pnpm lint` adds no new problems in touched files
- [ ] `search-results-group.tsx` renders a separate `<CommandGroup heading="Metadata">` only when metadata results exist; primary results render in the original group
- [ ] The pre-existing uncommitted edits in `search-results-group.tsx` / `command-palette.tsx` are still present (not reverted)
- [ ] No `src/app/api/**` or indexer changes (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The file has drifted such that the results-rendering block doesn't match the described structure (beyond the noted uncommitted edits).
- `SearchResult` lacks a `key` field (the classifier needs it) — report the real shape.
- A verification fails twice after a reasonable fix.

## Maintenance notes

- **Ranking caveat (deferred):** the search route still `LIMIT`s to 20 by score *before* the UI partitions, so a folder dominated by metadata could fill the top 20 and leave few primary results. If that proves to be a problem, the durable fix is server-side: deprioritize likely-metadata in the SQL `ORDER BY` (Postgres `~` regex on the key) or raise the limit and trim per-group in the UI. That's a separate plan; this one only stops metadata from *visually* swamping real hits.
- The heuristic lives in one place (`metadata-filter.ts`). To make the meta-folder names configurable per connection later, thread a config list into `isLikelyMetadata` instead of the hardcoded `META_SEGMENTS`.
- Reviewer should confirm the metadata group only appears when non-empty and that selecting an item in either group still navigates correctly (same `onSelectFile`/`onSelectFolder`).
