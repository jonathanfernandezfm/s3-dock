# Global Search Across All Connections — Design

**Date:** 2026-06-05
**Scope:** New feature. Adds a background-indexed, sub-300ms fuzzy search across every connection in every workspace the user belongs to, surfaced inside the existing command palette. PRO-gated.

## Problem

Today, finding a file in s3client requires the user to know — or guess — which connection, which bucket, and which path it lives in. The existing per-bucket file list is fast and accurate, but only within one bucket at a time. There is no way to ask "where's the invoice PDF I uploaded last month?" without remembering where you put it.

At small scale this is a minor inconvenience. At real S3 scale — multiple connections, dozens of buckets, millions of objects — it's the single biggest UX gap. Competing tools either don't solve this at all (AWS Console, Cyberduck) or solve it slowly via on-demand crawl (S3 Browser). Solving it well requires an index, a freshness model, and a query path that all stay out of the user's way.

The strategic angle: this feature is the demo's "wait, that's actually impressive" moment. Type a few characters, hit results across every connection the user can see, sub-300ms, with operators for filetype, size, and date. It's hard to clone quickly because the value is in the index pipeline, not in the UI.

## Decision

Build a **PostgreSQL-backed object metadata index** with three update flows: an **initial crawl** on connection create, **inline write-through** from app mutations, and a **periodic reconcile crawl** to catch external changes. Surface search through a new group in the existing command palette. PRO-gate the feature server-side.

The index is **list-derived only** — no per-object `HeadObject` or `GetObjectTagging` calls. Mime is inferred from extension via a static map (~150 common types). Tags are indexed only when the app itself writes them through `/api/objects/tag`. External tag changes are not surfaced in search. This is an explicit accuracy/cost tradeoff: list calls amortize at ~$5 per million objects (1k objects per request); head/tag calls require one request per object and would cost roughly an order of magnitude more — plus they'd multiply initial crawl wall-time by the same factor.

The query path is a single SQL statement with a composite `(workspace_id, search_text gin_trgm_ops)` GIN index — tenant-narrowed before fuzzy matching — landing comfortably under the 300ms target up to ~10M index rows per workspace.

### Search scope

A query searches across **every connection in every workspace the user belongs to** (personal workspace + all team workspaces where the user is a member). Results are grouped per connection so the user knows where each hit lives. Workspace scoping is the only permission check applied to results; it is enforced at the query layer with `workspace_id = ANY($user_workspace_ids)`.

### Freshness model

Three flows feed the index:

| Flow | Trigger | Latency to visible |
|---|---|---|
| Initial crawl | Connection creation | Seconds to minutes (depends on size) |
| Write-through | Any mutation through s3client (upload, delete, move, copy, rename, tag, folder create) | Synchronous with the mutation |
| Periodic reconcile | Cron tick, per connection | ~60 minutes for external changes |

Write-through makes "I just uploaded a file" immediately findable. Reconcile catches changes made through other tools (AWS CLI, console, other apps). Together they keep the index closely aligned with reality without requiring S3 event configuration.

### Tier gating

PRO+ only. Free users see the existing palette unchanged, plus a single teaser row when they type a query (`✨  Search across all your files — Upgrade →`) that opens the existing `PlansModal`. The server endpoint refuses requests from FREE users; tier is checked via the existing `useTier` hook on the client and `protect()` + tier guard on the server.

### Surface

Command palette only. The existing Cmd-K palette gets a new **Files** group that renders server-fuzzy results, alongside the existing local groups (Pinned, Recent, Actions, Connections, Buckets, Folders, Teams) which continue to filter client-side via cmdk. There is no separate `/search` page in v1.

## Out of scope (v1)

- **Search inside file contents.** Only metadata (name, path, size, date, extension, app-written tags). Full-text search of object bodies is a much bigger project.
- **External tag indexing.** Tags set via AWS CLI/console don't appear in `tag:` filters. They still display in the info drawer (read live).
- **Authoritative ContentType.** Mime is inferred from extension; we never call `HeadObject`. A file named `report.png` is indexed as `image/png` regardless of its actual stored ContentType.
- **Per-search-result preview generation.** Clicking a result navigates to the parent folder and triggers the existing preview modal — no new preview pipeline.
- **A dedicated `/search` page.** Everything lives in the palette.
- **Cross-workspace permission overrides.** Search visibility tracks workspace membership exactly; there's no "shared search index" between teams.
- **Real-time index over WebSocket.** Updates are inline (write-through) or polled (reconcile). No push model.
- **Beyond 2M objects per connection.** Connections with more than 2M objects get a partial index and a visible badge. Lifting this cap is future work.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Command Palette (Cmd-K)                      │
│  search mode → useGlobalSearch() → /api/search?q=...&filters=... │
└─────────────────────────┬────────────────────────────────────────┘
                          │ debounced 100ms, <300ms target
                          ▼
              ┌───────────────────────┐
              │   /api/search route   │  parses operators, builds SQL
              │   (auth + workspace   │  ranks by trigram similarity
              │    scoping)           │  returns grouped top 20
              └───────────┬───────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │     PostgreSQL        │
              │  ┌─────────────────┐  │
              │  │  ObjectIndex    │◀─┼── write-through from mutations
              │  │  + pg_trgm GIN  │  │   (/api/objects/upload, /delete,
              │  │  + tags JSONB   │  │   /move, /copy, /rename, /tag)
              │  └─────────────────┘  │
              │  ┌─────────────────┐  │
              │  │   CrawlJob      │◀─┼── checkpoints for resumable
              │  │  (state cursor) │  │   ListObjectsV2 walks
              │  └─────────────────┘  │
              └───────────┬───────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ /api/internal/crawl   │  enqueued on connection create
              │ /api/internal/        │  + hit by external cron every
              │   reconcile           │  ~5 min per worker tick
              └───────────┬───────────┘
                          │
                          ▼
                    AWS SDK v3
                ListObjectsV2 (paginated)
```

**Boundaries.** The query path lives entirely in `/api/search` and touches PG only — never S3. The write-through helpers are thin wrappers around upserts/deletes called from existing mutation routes; their failures never block the user's action. The crawl pipeline is a self-contained subsystem under `src/lib/search/crawl/`, resumable across serverless invocations via persistent checkpoints in `CrawlJob`.

**New code locations.**

| Path | Purpose |
|---|---|
| `prisma/schema.prisma` | `ObjectIndex` + `CrawlJob` models, `Connection` back-relations |
| `prisma/migrations/2026XXXX_global_search/` | Schema + raw SQL for extensions and composite GIN index |
| `src/lib/search/index-ops.ts` | `indexUpsert`, `indexDelete`, `indexRename`, `indexUpdateTags`, `indexBulkUpsert` |
| `src/lib/search/crawl/walk.ts` | Per-tick crawl loop (resumable ListObjectsV2 walk) |
| `src/lib/search/crawl/buckets.ts` | Bucket discovery via `ListBuckets` |
| `src/lib/search/crawl/sweep.ts` | Stale-row deletion after reconcile completes |
| `src/lib/search/mime-from-ext.ts` | Static extension→mime map, compound-extension handling |
| `src/lib/search/query.ts` | Operator parser, SQL builder |
| `src/lib/queries/search.ts` | React Query hook `useGlobalSearch` |
| `src/app/api/search/route.ts` | Query endpoint |
| `src/app/api/internal/crawl/route.ts` | Crawl tick (resumable) |
| `src/app/api/internal/reconcile/route.ts` | Cron entry point |
| `src/components/command-palette/search-results-group.tsx` | New palette group |
| `src/components/command-palette/operator-chips.tsx` | Operator pill rendering |
| `src/components/command-palette/highlight-matches.tsx` | Match-highlight helper |

Modified files: `src/components/command-palette/command-palette.tsx` (mount new group), all mutation routes under `src/app/api/objects/` (add write-through helper calls), `src/app/api/connections/route.ts` (enqueue initial crawl), `src/app/api/buckets/[bucket]/route.ts` (delete index rows on bucket delete).

## Data model

### Prisma schema additions

```prisma
enum CrawlJobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  PARTIAL_LIMIT_HIT
}

enum CrawlJobKind {
  INITIAL
  RECONCILE
}

model ObjectIndex {
  id            String   @id @default(uuid())

  // Denormalized for fast scoping; saves a join on every query.
  workspaceId   String

  connectionId  String
  connection    Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  bucket        String
  key           String

  size          BigInt
  lastModified  DateTime
  etag          String?

  // Derived locally; no per-object API calls.
  extension     String?
  mime          String?

  // App-side tags (written by /api/objects/tag); external tags are not tracked.
  tags          Json     @default("[]")

  // Generated by Postgres; see migration below.
  searchText    String

  // Set on every write. Reconcile sweeps rows where lastSeenAt < job.startedAt.
  lastSeenAt    DateTime @default(now())

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([connectionId, bucket, key])
  @@index([workspaceId, lastModified(sort: Desc)])
  @@index([connectionId, lastSeenAt])
  @@map("object_index")
}

model CrawlJob {
  id                    String          @id @default(uuid())

  connectionId          String
  connection            Connection      @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  kind                  CrawlJobKind
  status                CrawlJobStatus  @default(PENDING)

  // Resumable cursor state.
  currentBucket         String?
  bucketsRemaining      String[]
  nextContinuationToken String?

  objectsIndexed        Int             @default(0)

  startedAt             DateTime?
  lastTickAt            DateTime?
  completedAt           DateTime?

  errorMessage          String?

  createdAt             DateTime        @default(now())

  @@index([connectionId, kind, status])
  @@index([status, lastTickAt])
  @@map("crawl_jobs")
}
```

`Connection` gets back-relations `objectIndex ObjectIndex[]` and `crawlJobs CrawlJob[]`.

### Raw SQL migration (after Prisma generates the base)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE object_index
  ADD COLUMN search_text TEXT GENERATED ALWAYS AS (
    unaccent(lower(bucket || ' ' || replace(key, '/', ' ')))
  ) STORED;

CREATE INDEX idx_object_index_search
  ON object_index USING gin (workspace_id, search_text gin_trgm_ops);
```

The composite `btree_gin` index is the single most important performance decision. Without it, every fuzzy search scans rows from all workspaces and filters after; with it, the planner uses `workspace_id` to narrow first, then fuzzy-matches inside the tenant's rows. `unaccent` makes `café` match `cafe`.

### Mime map

`src/lib/search/mime-from-ext.ts` exports a static map covering the common types we expect to encounter:

- Images: `png`, `jpg`/`jpeg`, `gif`, `webp`, `svg`, `bmp`, `ico`, `tiff`, `heic`, `avif`
- Video: `mp4`, `mov`, `webm`, `mkv`, `avi`, `wmv`, `m4v`
- Audio: `mp3`, `wav`, `ogg`, `flac`, `aac`, `m4a`, `opus`
- Documents: `pdf`, `doc`/`docx`, `xls`/`xlsx`, `ppt`/`pptx`, `odt`, `ods`, `epub`
- Text/code: `txt`, `md`, `csv`, `json`, `xml`, `yaml`/`yml`, `js`, `ts`, `tsx`, `jsx`, `py`, `rs`, `go`, `java`, `c`, `cpp`, `h`, `css`, `html`, `sh`, `sql`, `toml`
- Archives: `zip`, `tar`, `gz`, `7z`, `rar`, `bz2`
- Compound extensions: `tar.gz` → `application/gzip` (treat as archive); compound detection is keyed on the last two segments.

Unknown extensions get `mime = null`, `extension = <ext>`. Search by `mime:` still works for known mimes; unknown extensions match by `ext:`.

The `mime` filter accepts both exact (`mime:image/png`) and group-prefix (`mime:image`) forms. The query rewrites the latter to `mime LIKE 'image/%'`.

## Crawl + write-through pipeline

### Initial crawl

```
POST /api/connections (existing route)
  → connection row created
  → INSERT CrawlJob { kind: INITIAL, status: PENDING, bucketsRemaining: [] }
  → fire-and-forget fetch /api/internal/crawl?jobId=... (no await)
  → return 201 to user immediately

/api/internal/crawl?jobId=X (auth: header x-internal-token=$INTERNAL_API_TOKEN)
  → load job, mark RUNNING (set startedAt if null), set lastTickAt = NOW()
  → if bucketsRemaining is empty AND currentBucket is null:
       call ListBuckets, populate bucketsRemaining, set currentBucket = bucketsRemaining.shift()
  → loop until (page count >= 50) OR (elapsed >= 50s) OR (objectsIndexed >= 2_000_000):
       page = ListObjectsV2(bucket=currentBucket, ContinuationToken=nextContinuationToken)
       bulkUpsert(page.Contents)  // single INSERT ... ON CONFLICT ... DO UPDATE
       if page.IsTruncated:
         nextContinuationToken = page.NextContinuationToken
       else:
         currentBucket = bucketsRemaining.shift() || null
         nextContinuationToken = null
       if currentBucket === null and bucketsRemaining.length === 0:
         break  // done
  → persist checkpoint
  → if objectsIndexed >= 2_000_000:
       mark PARTIAL_LIMIT_HIT, set completedAt, return
  → if currentBucket is null:
       mark COMPLETED, set completedAt, return
  → else: fire-and-forget fetch /api/internal/crawl?jobId=X (self-refire)
```

Each tick is bounded (~50s, well under typical 60s serverless function limits) and persists state before returning. The self-refire keeps initial crawl moving quickly without holding a single long-running connection.

### Write-through helpers

`src/lib/search/index-ops.ts`:

```ts
indexUpsert(ctx, { workspaceId, connectionId, bucket, key, size, lastModified, etag })
indexDelete(ctx, { connectionId, bucket, key })
indexRename(ctx, { workspaceId, connectionId, bucket, fromKey, toKey, size, lastModified, etag })
indexUpdateTags(ctx, { connectionId, bucket, key, tags })
indexBulkUpsert(ctx, items[])           // used by crawl
```

Hooks into existing mutation routes:

| Route | Helper call |
|---|---|
| `/api/objects/upload` | `indexUpsert` after S3 PUT succeeds |
| `/api/objects/delete` | `indexDelete` after S3 DELETE succeeds |
| `/api/objects/move` | `indexDelete(from) + indexUpsert(to)` in a single tx |
| `/api/objects/copy` | `indexUpsert(to)` |
| `/api/objects/rename` | `indexRename` (delete+insert in single tx) |
| `/api/objects/tag` | `indexUpdateTags` |
| `/api/objects/folder` | `indexUpsert` (folder markers are 0-byte objects) |
| `/api/buckets/[bucket]` DELETE | `DELETE FROM object_index WHERE connection_id=$1 AND bucket=$2` |

**Failure policy.** Every helper call wrapped at the call site:

```ts
try {
  await indexUpsert(...);
} catch (err) {
  console.error('[search-index] write-through failed', { op: 'upload', ctx, err });
}
```

The user's mutation succeeds regardless. Reconcile reconciles.

### Periodic reconcile

An external scheduler (Vercel Cron, `pg_cron`, or any uptime monitor) hits `/api/internal/reconcile` every ~5 minutes. The route:

```
for each Connection where (
   (no RECONCILE CrawlJob completed in the last 60 min)
   AND (no RECONCILE CrawlJob currently RUNNING)
):
   create CrawlJob { kind: RECONCILE, status: PENDING, startedAt: NOW() }
   fire-and-forget fetch /api/internal/crawl?jobId=...

// Stuck-job rescue.
for each CrawlJob where status = RUNNING AND lastTickAt < NOW() - 10 min:
   reset to status = PENDING
   fire crawl tick
```

The crawl tick is mode-agnostic — INITIAL and RECONCILE share the same loop. The only difference is the **sweep** that runs after a RECONCILE job marks COMPLETED:

```sql
DELETE FROM object_index
WHERE connection_id = $1
  AND last_seen_at < $jobStartedAt;
```

This removes rows for objects that no longer exist in S3. Captured `startedAt` before the walk begins; any write-through during the walk sets `last_seen_at = NOW()` which is safely above the sweep threshold, so concurrent writes are not false-deleted.

### Auth for internal routes

`/api/internal/crawl` and `/api/internal/reconcile` require header `x-internal-token: $INTERNAL_API_TOKEN`. The cron service and self-refire calls include the token. Without it: 401. The token is a single high-entropy env var, rotated manually if needed.

### S3 client + decryption

Each crawl tick decrypts `Connection.secretAccessKey` once using `src/lib/crypto.ts` and reuses the resulting `S3Client` for the tick's duration. No new key material is exposed beyond what the existing connection code already handles.

## Query layer

### Endpoint

```
GET /api/search?q=<text>&limit=20

Auth: protect()
Tier: requireTier('PRO')
```

The `q` parameter holds the raw user input (free text plus inline operators). `limit` defaults to 20, max 50.

### Operator parser

`src/lib/search/query.ts` exports a pure function:

```ts
type ParsedQuery = {
  freeText: string;
  mime?: string;        // 'image', 'pdf', 'video', 'audio', 'text', or 'image/png'
  ext?: string;
  sizeMin?: bigint;
  sizeMax?: bigint;
  before?: Date;
  after?: Date;
  bucket?: string;
  connection?: string;  // matches connection.name (ILIKE)
  tag?: string;
};

parseSearchQuery(input: string): ParsedQuery
```

Recognized operators:

- `mime:<group-or-exact>` — `mime:image` rewrites to `LIKE 'image/%'`; `mime:image/png` is exact.
- `ext:<extension>` — exact match on `extension` column.
- `size:>10mb` / `size:<1gb` / `size:>=100kb` / `size:<=1b` — units `b`, `kb`, `mb`, `gb`; comparators `>`, `<`, `>=`, `<=`.
- `before:<date>` / `after:<date>` — ISO date (`2026-01-01`) or `yesterday`/`today`/`7d`.
- `in:<bucket>` — exact bucket name.
- `connection:<name>` — ILIKE on connection name; supports quoted strings for names with spaces.
- `tag:<value>` — JSONB containment (`tags ? $tag`).

Unknown `foo:bar` patterns fall through to `freeText` so users searching for literal `version:1.2` aren't surprised.

### The query

```sql
SELECT
  oi.id, oi.workspace_id, oi.connection_id,
  oi.bucket, oi.key, oi.size, oi.last_modified,
  oi.mime, oi.extension, oi.tags,
  c.name AS connection_name,
  c.endpoint AS connection_endpoint,
  CASE WHEN $query_text = '' THEN 0
       ELSE similarity(oi.search_text, $query_text) END AS score
FROM object_index oi
JOIN connections c ON c.id = oi.connection_id
WHERE oi.workspace_id = ANY($workspace_ids)
  AND ($query_text = '' OR oi.search_text % $query_text)
  AND ($mime IS NULL OR oi.mime LIKE $mime_pattern)
  AND ($ext IS NULL OR oi.extension = $ext)
  AND ($size_min IS NULL OR oi.size >= $size_min)
  AND ($size_max IS NULL OR oi.size <= $size_max)
  AND ($before IS NULL OR oi.last_modified < $before)
  AND ($after IS NULL OR oi.last_modified >= $after)
  AND ($bucket IS NULL OR oi.bucket = $bucket)
  AND ($connection IS NULL OR c.name ILIKE $connection_pattern)
  AND ($tag IS NULL OR oi.tags ? $tag)
ORDER BY
  score DESC,
  oi.last_modified DESC
LIMIT $limit;
```

Empty `freeText` (palette opened, no text) sorts purely by `last_modified DESC` and returns "recent files anywhere" as the zero-state.

### Workspace scoping (security-critical)

```ts
const user = await protect();
const workspaceIds = await getUserWorkspaceIds(user.id);
// includes personalWorkspace + every TeamMember.team.workspace
if (workspaceIds.length === 0) return { results: [] };
// $workspace_ids is the ONLY scoping check; never trust client-supplied workspace filters.
```

The SQL builder helper takes `userWorkspaceIds` as a required non-nullable parameter; it cannot construct a query without it. The `workspace_id = ANY($workspace_ids)` clause is always emitted.

### Response shape

```ts
{
  results: [
    {
      id, workspaceId, connectionId, connectionName, endpoint,
      bucket, key, size, lastModified, mime, extension, tags,
      score,
      href: `/browser/${connectionId}/${bucket}/${dirname(key)}`,
    }
  ],
  parsedQuery: { freeText, mime, sizeMin, ... },
  partial: boolean,  // true if any in-scope connection has PARTIAL_LIMIT_HIT
}
```

`parsedQuery` is echoed so the UI can render operator chips. `partial` lets the UI display a "partial index" badge when results may be incomplete.

### Performance budget

| Stage | Target | Notes |
|---|---|---|
| Parse + auth + workspaceIds lookup | <20ms | workspace lookup cached in `lru-cache` (60s TTL) |
| SQL execution | <100ms p95 | composite GIN does the heavy lifting |
| Serialization | <10ms | LIMIT 20, small payload |
| Network (LAN to PG) | <30ms | within same region |
| **Total server budget** | **<160ms** | leaves headroom for typing-debounce |
| **End-to-end target** | **<300ms** | including network to browser |

Escape hatch if we miss the target at scale: a 10s in-memory LRU cache keyed by `(userId, normalized-query)` — typical palette UX hammers the same prefix as the user types.

### Rate limiting

Sliding-window per-user throttle using LRUCache: max 30 requests / 10s. Returns 429 above that. Search is cheap but not free; this protects PG from runaway clients (and from accidental infinite-loop UI bugs).

## Palette UI integration

### New group inside the existing palette

The existing palette (`src/components/command-palette/command-palette.tsx`) gets a new `<SearchResultsGroup />` mounted near the top of `<CommandList>`, alongside the existing Pinned/Recent/Actions/Connections/Buckets/Folders/Teams groups.

```tsx
<CommandGroup heading="Files">
  {results.map(r => (
    <CommandItem key={r.id} value={r.id} forceMount onSelect={() => navigate(r)}>
      <FileIcon mime={r.mime} extension={r.extension} />
      <div>
        <span>{highlightMatches(basename(r.key), parsedQuery.freeText)}</span>
        <span className="muted">
          {r.connectionName} · {r.bucket}/{dirname(r.key)}
        </span>
      </div>
      <span className="ml-auto muted">{formatBytes(r.size)} · {formatTime(r.lastModified)}</span>
    </CommandItem>
  ))}
</CommandGroup>
```

**`forceMount`** keeps each server result rendered regardless of cmdk's internal substring filter, so the server's similarity ranking wins. The existing local groups keep their existing cmdk-filtered behavior unchanged.

### Hook

`src/lib/queries/search.ts`:

```ts
function useGlobalSearch(query: string, parsedQuery: ParsedQuery) {
  const tier = useTier();
  const debounced = useDebounced(query, 100);

  return useQuery({
    queryKey: ['search', debounced, parsedQuery],
    queryFn: () => fetch(`/api/search?q=${encodeURIComponent(debounced)}`).then(r => r.json()),
    enabled: tier === 'PRO' && debounced.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
```

`placeholderData: keepPreviousData` prevents the result list from flickering empty as the user keeps typing.

### Operator chips

Parsed operators render as removable pills above the input:

```
[mime: pdf ×]  [size: > 1MB ×]  [after: 2026-01-01 ×]   invoice
```

Clicking × strips that operator from the query text. When the user types `mime:` (no value yet), an inline suggester appears with `image`, `video`, `audio`, `pdf`, `text`; similar pattern for `ext:` and `in:` (the latter typed against the user's known buckets).

### Match highlighting

`src/components/command-palette/highlight-matches.tsx` splits `query` into tokens and wraps each occurrence in the displayed `text` with `<mark>`. Token-level, case-insensitive. Doesn't replicate pg_trgm's full fuzzy logic; trigram-fuzzy results that don't substring-match still display, just without highlight.

### Click behavior

- **File** (key doesn't end in `/`): navigate to parent folder via `updateTabBucket` + `updateTabPath`, then open the preview modal for that file by setting an intent flag in `palette-intent-store`. The browser page reads the intent on mount and opens the file.
- **Folder marker** (key ends in `/`): navigate into the folder, no preview.

Either path calls `pushRecent` so the result appears in Recent next time.

### Tier gating in the palette

Free users:
- `useGlobalSearch` is disabled (`enabled: tier === 'PRO'`); existing local groups behave as today.
- One teaser row at the top of the result area when query.length ≥ 2:
  ```
  ✨  Search across all your files       Upgrade →
  ```
  Click opens the existing `PlansModal`.

Mirrors the existing `LockedPageOverlay` / `FeatureGate` pattern in the codebase.

### Loading / empty / error / partial states

| State | What user sees |
|---|---|
| `query.length < 2` | Existing palette only, no Files group |
| Loading first time | Two skeleton rows under "Files" |
| Loading subsequent | Previous results stay (kept by `placeholderData`), faint loading dot |
| Zero results | Single muted row: "No files match." |
| Error | No Files group (silent fail); local items still work; toast on second consecutive failure |
| Partial index in scope | Badge after "Files" heading: `"Files · partial index"`, tooltip explains 2M cap |

### Keyboard

Nothing custom. cmdk handles ↑↓ and Enter across all groups, including `forceMount` items. Esc closes. Tab cycles operator chips when focused.

## Error handling & edge cases

### Failure modes

| Failure | Detection | Response |
|---|---|---|
| Crawl: invalid credentials | S3 SDK auth error | Mark `CrawlJob` FAILED, `errorMessage` recorded. Connection settings shows "Search index error — re-check credentials". No retry until user edits the connection. |
| Crawl: S3 transient (5xx, network) | Exception in tick | Persist checkpoint, stay RUNNING, let reconcile pick up. Max 3 consecutive failed ticks → mark FAILED for surface. |
| Crawl: bucket inaccessible mid-walk | 403 on `ListObjectsV2` | Skip that bucket, continue. Log + record skipped bucket in `errorMessage` as JSON. |
| Crawl: connection deleted mid-tick | Cascade kills the job | Tick checks job exists before each batch; exits cleanly if gone. |
| Crawl: tick exceeds time budget | Internal time check | Persist checkpoint, return 200, rely on self-refire or next reconcile. |
| Write-through: PG write fails | Try/catch around helper | Log `[search-index]` with full ctx, swallow. Reconcile reconciles. |
| Write-through: concurrent modify | `INSERT … ON CONFLICT … DO UPDATE` | Atomic; last write wins, which is correct. |
| Stuck/zombie job | `RUNNING` with `lastTickAt < NOW() - 10 min` | Reset to PENDING, fire crawl tick. |
| 2M cap hit | `objectsIndexed >= 2_000_000` check | Mark `PARTIAL_LIMIT_HIT`. UI shows badge on connection + search results badge. |
| Search: PG slow query | Soft timeout in route handler | 1s timeout → 504 "Search temporarily unavailable". Local palette items still work. |
| Tier downgrade (PRO → FREE) | Stripe webhook | Keep `ObjectIndex` rows (cheap, easy to re-enable). Disable `/api/search` for the user. No active crawls cancelled mid-tick. Re-upgrade re-enables instantly. |
| Workspace deletion | Cascade | All `ObjectIndex` + `CrawlJob` rows removed automatically. |

### Edge cases

- **Unicode in keys**: handled via `unaccent` extension in the generated `search_text` column. `café` matches `cafe`.
- **Very long keys** (S3 max 1024 chars): no special handling; pg_trgm scales, but GIN entry size grows. Monitor for index bloat.
- **Folder markers** (0-byte keys ending in `/`): indexed normally; surfaced with folder icon; navigation enters the folder rather than opening preview.
- **Buckets created/deleted externally**: discovered/lost via `ListBuckets` at the start of each reconcile. New buckets get crawled; deleted buckets' rows are swept naturally as their objects stop being seen.
- **Connection rename**: no index update needed — `connectionName` is joined fresh at query time.
- **Concurrent reconcile + write-through**: `lastSeenAt` is set to `NOW()` on write-through; sweep deletes where `lastSeenAt < jobStartedAt`. As long as `jobStartedAt` is captured before the walk begins, write-through during the walk only updates `lastSeenAt` to a value safely above the threshold — no false deletes.
- **Existing connections at deploy time**: migration enqueues a one-shot `CrawlJob { kind: INITIAL }` for every existing connection in PRO workspaces. The reconcile cron picks them up gradually so we don't hammer S3.

## Observability

### User-visible

Connection settings panel gets a "Search index" row showing one of:
- `Indexed N objects · last reconciled <relative-time>`
- `Indexing… N / ~est objects`
- `Partial index (2M cap reached) — Contact support`
- `Error: <message> — Re-check connection`

Each `/api/search` response includes `partial: boolean`; when true, the palette shows a `"Files · partial index"` badge so users know results may be incomplete.

### Internal logging

Lightweight `console` logs (no new infrastructure):

- `[search-index] crawl tick start jobId=X bucket=Y token=...`
- `[search-index] crawl tick done objectsIndexed=N elapsedMs=M`
- `[search-index] write-through failed op=upload conn=X bucket=Y key=Z err=…`
- `[search] query took=Nms results=K workspaces=[a,b,c]`

Easy to grep, no new dependencies.

## Testing strategy

### Unit tests (Vitest)

- `src/lib/search/query.test.ts` — table-driven operator parser tests (25+ cases): all operators, edge cases (`mime:image/png`, `size:>10mb`, `before:yesterday`, `connection:"name with spaces"`, unknown-operator fallthrough, empty query, only-operators query).
- `src/lib/search/mime-from-ext.test.ts` — static map lookup including `.tar.gz` compound, no-extension files, unknown extensions.
- `src/components/command-palette/highlight-matches.test.ts` — tokenization, overlapping matches, case insensitivity, empty query.
- `src/lib/search/index-ops.test.ts` — `indexRename` atomicity (same-tx delete + insert).

### Integration tests (PG required; matches pattern in `src/lib/db/notes.test.ts`, `src/lib/db/bookmarks.test.ts`)

- `src/lib/search/search-query.test.ts` — seed `ObjectIndex` with 1k rows across 3 workspaces, run real queries:
  - Workspace scoping (user in A can't see B's rows).
  - Trigram ranking (closer matches first).
  - Operators combine correctly.
  - Sweep removes stale rows when `lastSeenAt < jobStartedAt`.
- `src/lib/search/crawl/walk.test.ts` — mock S3 client returns canned pages, verify checkpoint persisted, verify upserts, verify cap triggers `PARTIAL_LIMIT_HIT`.
- `src/lib/search/write-through.test.ts` — exercise each helper against a real PG, assert index reflects state.

### Performance probe (manual, not CI)

Seed 5M rows in one workspace, run 100 representative queries, assert p95 < 100ms server-side. Documented in `docs/superpowers/specs/` as a perf note alongside this design.

### Manual demo verification

Spin dev server, add a connection with a real test bucket containing diverse files, wait for initial crawl, exercise palette search with each operator type, confirm sub-300ms feel.

## Rollout

1. Ship migration (extensions, tables, indexes) — backward compatible.
2. Ship write-through helpers wired into mutation routes — feature-flagged by env var `SEARCH_INDEX_ENABLED`. With flag off, helpers no-op.
3. Ship crawl + reconcile endpoints with same flag.
4. Ship palette UI behind same flag.
5. Enable flag, monitor crawl progress and write-through error rate.
6. Backfill: trigger initial crawl for existing PRO connections via one-off SQL inserting `CrawlJob { kind: INITIAL }` rows. The reconcile cron picks them up gradually.

If anything goes wrong at any step, flag off → palette behaves exactly as today, no data corruption (rows are inert without the search endpoint reading them).
