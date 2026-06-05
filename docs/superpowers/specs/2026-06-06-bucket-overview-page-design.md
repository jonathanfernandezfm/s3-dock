# Bucket Overview Page Design

**Date:** 2026-06-06
**Status:** Approved
**Headline value:** Replace the "Coming soon" placeholder on the bucket detail Overview tab with a working dashboard — identity, versioning controls (moved from the file-browser toolbar), on-demand storage stats, recent activity, and an incomplete-uploads shortcut. Makes Overview the natural landing surface for per-bucket info and admin actions.

---

## Goal

Build out the Overview tab inside the existing `BucketDetailTabs` so users get an at-a-glance summary of a bucket and one obvious place to flip versioning on/off. Move the `BucketVersioningToggle` out of the file-browser toolbar (where it's noisy and out of context) and onto the Overview, where it belongs alongside other bucket-level controls.

## Non-goals (v1)

- **No encryption, replication, public-access-block, lifecycle, or bucket policy cards.** Those have their own tabs/roadmap. Overview is a summary, not a settings dump.
- **No automatic stats computation.** Object counting paginates the full bucket; we explicitly require a button click to start it. No background auto-refresh, no "refresh every N seconds" polling.
- **No truncation/cap on the stats pagination.** v1 fetches all pages of `ListObjectsV2` without bound. The on-demand button surfaces the cost; if real-world buckets are too big to count reasonably, revisit with a server-side timeout.
- **No component-level tests for the new UI.** Matches the codebase's current discipline (only server helpers and reducers are unit-tested). The stats reducer is the testable surface.
- **No new tabs.** Overview is one of the four existing tabs declared in `BucketDetailTabs`.

---

## User-facing behavior

### Entry points

- `/buckets/[connectionId]/[bucket]` (direct nav) — defaults to `?tab=overview` (was `multipart`).
- Bucket card dropdown → "Settings" menu item — now points to `?tab=overview` (was `?tab=multipart`).
- Tab nav bar inside `BucketDetailTabs` — already includes "Overview".

### Layout

Full-width Identity card on top, then a responsive 2-column grid (`grid-cols-1 md:grid-cols-2`) below:

```
┌──────────────────────────────────────────────────────────┐
│ IDENTITY CARD (full width)                               │
│  bucket name · connection · region · endpoint · created  │
└──────────────────────────────────────────────────────────┘
┌────────────────────────┬─────────────────────────────────┐
│ VERSIONING CARD        │ STORAGE STATS CARD              │
└────────────────────────┴─────────────────────────────────┘
┌────────────────────────┬─────────────────────────────────┐
│ ACTIVITY CARD          │ INCOMPLETE UPLOADS CARD         │
└────────────────────────┴─────────────────────────────────┘
```

Outer wrapper: `space-y-4`. Inner grid: `grid grid-cols-1 md:grid-cols-2 gap-4`. Cards use the existing `@/components/ui/card` primitive.

### Card behavior

**Identity card.** Pure presentational. Receives `{ connection, bucketMeta }` as props (parent owns the fetching). Uses `Card`, `CardHeader`, `CardTitle`, `CardContent` from `@/components/ui/card`. Body is a `<dl>` with two-column rows (label / value):

- Bucket name (with `Database` icon, monospace value)
- Connection (`connection.name || connection.endpoint`; rendered as a `<Link>` to `/connections#connection-{connection.id}`)
- Region (`connection.region` raw string; "Unknown" when empty)
- Endpoint URL (`connection.endpoint`, monospace)
- Created (`formatDate(bucketMeta.creationDate)`; "Unknown" if `creationDate` is missing)

Source data (fetched by `OverviewTab`, passed in as props): `useConnections()` filtered by `id === connectionId`; `useBuckets(connectionId)` filtered by `name === bucket`.

**Versioning card.** Replaces the dropdown UI of the old `BucketVersioningToggle` with a richer card.

| Status | Pill color | Explainer (always shown) |
|---|---|---|
| `Enabled` | green | "New uploads create a new version. Deletes leave a delete marker. Older versions stay until purged." |
| `Suspended` | yellow | "New uploads overwrite the current version. Existing versions are preserved." |
| `Disabled` | muted | "Versioning has never been turned on. Once enabled it can be suspended but not turned off." |

Buttons row:
- `Enable` — disabled when status is `Enabled` OR mutation pending.
- `Suspend` — disabled when status is NOT `Enabled` OR mutation pending.

When `!canEdit` (viewer role): pills/explainer still rendered, buttons replaced by a small "Viewer — read only" hint.

Source data: `useBucketVersioning(connectionId, bucket)` + `useSetBucketVersioning(connectionId, bucket)`. Success/error toasts identical to the prior toggle's: `"Versioning enabled."` / `"Versioning suspended."` / `{ title: "Failed to enable/suspend", description: error.message }`.

**Storage stats card.** On-demand, never auto-runs.

| State | UI |
|---|---|
| Idle (initial / never fetched) | Explainer paragraph + `[Compute stats]` button |
| Loading (fetching) | Spinner + "Counting objects…" |
| Success | Three stat blocks: object count (formatted with `toLocaleString`), total size (human-readable: B / KB / MB / GB / TB), storage class breakdown table (class name, count, size). `[Refresh]` button. |
| Error | Error message + `[Retry]` button |

The explainer: "Counts all objects in the bucket and totals their size. May take a while on large buckets — does not run automatically."

Source data: new `useBucketStats(connectionId, bucket)` hook backed by new `POST /api/buckets/[bucket]/stats` endpoint. React Query `enabled: false`; button click calls `refetch()`. Result is cached at the React Query layer — leaving and returning to the Overview shows the previous result without re-fetching. `[Refresh]` re-runs.

**Activity card.** Last 5 events scoped to this bucket.

Each row: `<Avatar />` (reuse `src/components/info-drawer/avatar.tsx`) + "**Display Name** _verb_ **target** · _relative time_". Verbs come from a shared `ACTION_VERBS` map (extracted from `activity-tab.tsx` so both consumers use the same source). Target rendering: same `lastSegment` helper as `activity-tab.tsx` — last path segment of `key`, or `bucket` when `key` is null. Relative time uses existing `formatRelativeTime` from `src/components/info-drawer/format-time.ts`.

Empty state: "No activity yet."

Footer: `View all activity →` button that pulls both `setScope` and `open` from `useInfoDrawerStore()` then calls `setScope({ connectionId, bucket })` followed by `open("activity")`.

Source data: existing `useActivity({ connectionId, bucket })`. We slice `events.slice(0, 5)` from its `events` array.

**Incomplete uploads card.** Multipart shortcut.

| State | UI |
|---|---|
| Loading | Small inline spinner + "Checking for incomplete uploads…" |
| Zero count | "No incomplete uploads." (no link rendered) |
| Non-zero count | "**N** incomplete upload(s)" + `Review uploads →` link to `?tab=multipart` |
| Error | "Failed to load incomplete uploads." (silently — full UI is on the Multipart tab) |

Source data: existing `useIncompleteUploads(connectionId, bucket)`. Count = `uploads.length`.

### File browser toolbar (existing surface)

Remove the `<BucketVersioningToggle />` JSX element and its import from `file-browser.tsx`'s toolbar (currently sits between the Viewer badge and `<ViewModeToggle />`).

**Keep** the `useBucketVersioning(connectionId, bucket)` call and the "Versioning suspended" warning banner above the file list — the banner still provides useful in-context warning while browsing.

### Bucket card

The "Settings" dropdown item on `BucketCard` currently routes to `?tab=multipart`. Change to `?tab=overview`. No other change to the card (the small `History` icon for enabled-versioning stays).

### Default tab

`BucketDetailTabs` line 33: `const activeTab: TabKey = isTabKey(rawTab) ? rawTab : "multipart";` → change `"multipart"` to `"overview"`. URL params with explicit `?tab=` values still win, preserving deep links.

---

## Architecture

### File structure

**New files (created):**

| Path | Responsibility |
|---|---|
| `src/components/buckets/overview-tab.tsx` | Orchestrator: layout grid; pulls connection + bucket metadata; renders five cards |
| `src/components/buckets/overview-identity-card.tsx` | Identity card (name, connection, region, endpoint, created) |
| `src/components/buckets/overview-versioning-card.tsx` | Rich versioning status card with Enable/Suspend buttons |
| `src/components/buckets/overview-storage-stats-card.tsx` | On-demand stats: button, loading, results, refresh |
| `src/components/buckets/overview-activity-card.tsx` | Last 5 activity events + drawer-open footer |
| `src/components/buckets/overview-incomplete-uploads-card.tsx` | Multipart count + link to multipart tab |
| `src/components/activity/event-format.ts` | Shared `ACTION_VERBS` map + `lastSegment` + `eventTarget` helpers (extracted from `activity-tab.tsx`) |
| `src/lib/buckets/stats-helpers.ts` | Pure helpers: `accumulateObjectStats`, `formatBytes`, `summarizeStorageClasses`. Unit-testable. |
| `src/lib/buckets/stats-helpers.test.ts` | Unit tests for the helpers |
| `src/app/api/buckets/[bucket]/stats/route.ts` | New API endpoint (POST) — paginates `ListObjectsV2` and aggregates |

**Modified files:**

| Path | Change |
|---|---|
| `src/components/buckets/bucket-detail-tabs.tsx` | Default tab `"multipart"` → `"overview"`; replace `ComingSoonTab` for `overview` case with `<OverviewTab connectionId={connectionId} bucket={bucket} />` |
| `src/components/buckets/bucket-card.tsx` | "Settings" `router.push` target: `?tab=multipart` → `?tab=overview` |
| `src/components/browser/file-browser.tsx` | Remove `BucketVersioningToggle` import and JSX. Keep `useBucketVersioning` + suspended banner. |
| `src/lib/queries/buckets.ts` | Add `fetchBucketStats` + `useBucketStats` (initial `enabled: false`) |
| `src/lib/queries/keys.ts` | Add `bucketStats: { all, byBucket }` entry |
| `src/components/info-drawer/activity-tab.tsx` | Import `ACTION_VERBS`, `lastSegment`, `eventTarget` from new shared `event-format.ts` instead of declaring locally |

**Deleted files:**

| Path | Reason |
|---|---|
| `src/components/buckets/bucket-versioning-toggle.tsx` | Sole consumer (file-browser) removed; replaced by `OverviewVersioningCard` |

### Data flow

```
OverviewTab(connectionId, bucket)
  │
  ├── useConnections() ─→ pick {connection} where id===connectionId
  ├── useBuckets(connectionId) ─→ pick {bucket meta} where name===bucket
  │       (both feed Identity card; connection.role feeds Versioning canEdit)
  │
  ├── <OverviewIdentityCard connection bucket={bucketMeta} />
  │
  ├── <OverviewVersioningCard connectionId bucket canEdit />
  │       │
  │       ├─ useBucketVersioning(connectionId, bucket)  // existing
  │       └─ useSetBucketVersioning(connectionId, bucket)  // existing
  │
  ├── <OverviewStorageStatsCard connectionId bucket />
  │       │
  │       └─ useBucketStats(connectionId, bucket)  // NEW, enabled:false
  │               │
  │               ↓
  │            POST /api/buckets/[bucket]/stats  (NEW endpoint)
  │
  ├── <OverviewActivityCard connectionId bucket />
  │       │
  │       ├─ useActivity({ connectionId, bucket })  // existing
  │       └─ useInfoDrawerStore  // existing — for "View all activity"
  │
  └── <OverviewIncompleteUploadsCard connectionId bucket />
          └─ useIncompleteUploads(connectionId, bucket)  // existing
```

Each card owns its own loading/error state. One slow card never blocks another.

### API contract — `POST /api/buckets/[bucket]/stats`

**Auth:** `withAuth` + `getConnectionAccessById`. Any role can read stats; no role gate beyond access.

**Request body:**
```json
{ "connectionId": "<connection-uuid>" }
```

**Response (200):**
```json
{
  "objectCount": 12345,
  "totalSize": 9876543210,
  "storageClasses": [
    { "class": "STANDARD",    "count": 12000, "size": 9000000000 },
    { "class": "STANDARD_IA", "count": 345,   "size": 876543210  }
  ]
}
```

`storageClasses` is sorted descending by `size`. `class` falls back to `"STANDARD"` when the SDK returns `undefined` (S3 default).

**Errors:**
- `400` — missing `connectionId` or `bucket`
- `404` — connection not found / no access
- `500` — AWS error or unexpected exception; body `{ error: string }`

**Implementation:** Paginates `ListObjectsV2` with `MaxKeys: 1000`, no `Prefix`, no `Delimiter`, looping on `NextContinuationToken` until `IsTruncated === false`. For each `Contents` entry accumulate via `accumulateObjectStats` helper. Final result built from helper output.

### Pure helpers — `src/lib/buckets/stats-helpers.ts`

```ts
export interface ObjectStatsAccumulator {
  count: number
  size: number
  byClass: Map<string, { count: number; size: number }>
}

export function emptyAccumulator(): ObjectStatsAccumulator
export function accumulateObjectStats(
  acc: ObjectStatsAccumulator,
  contents: Array<{ Size?: number; StorageClass?: string }>,
): ObjectStatsAccumulator
export function summarizeStorageClasses(
  byClass: Map<string, { count: number; size: number }>,
): Array<{ class: string; count: number; size: number }>
export function formatBytes(bytes: number): string  // "1.23 GB"
```

Pure, no SDK, no fetch — directly unit-testable.

### React Query — `useBucketStats`

```ts
// src/lib/queries/buckets.ts (additions)

export interface BucketStats {
  objectCount: number
  totalSize: number
  storageClasses: Array<{ class: string; count: number; size: number }>
}

async function fetchBucketStats(
  connectionId: string,
  bucket: string,
): Promise<BucketStats> {
  const res = await fetch(`/api/buckets/${encodeURIComponent(bucket)}/stats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || "Failed to fetch bucket stats")
  }
  return res.json()
}

export function useBucketStats(connectionId: string, bucket: string) {
  return useQuery({
    queryKey: queryKeys.bucketStats.byBucket(connectionId, bucket),
    queryFn: () => fetchBucketStats(connectionId, bucket),
    enabled: false,           // never auto-runs
    staleTime: Infinity,      // result is a snapshot; only refreshed on explicit refetch
    gcTime: 5 * 60 * 1000,    // hold result for 5 min after unmount
  })
}
```

### Query keys — `src/lib/queries/keys.ts`

Append to the `queryKeys` object:

```ts
bucketStats: {
  all: ["bucket-stats"] as const,
  byBucket: (connectionId: string, bucket: string) =>
    [...queryKeys.bucketStats.all, connectionId, bucket] as const,
},
```

### Shared activity formatting — `src/components/activity/event-format.ts`

Extract `ACTION_VERBS`, `lastSegment`, and `eventTarget` from `activity-tab.tsx` into a single shared module:

```ts
import type { ActivityAction } from "@/generated/prisma/client";
import type { ActivityEventResponse } from "@/lib/queries/activity";

export const ACTION_VERBS: Record<ActivityAction, string> = {
  UPLOAD: "uploaded",
  DELETE: "deleted",
  COPY: "copied",
  MOVE: "moved",
  RENAME: "renamed",
  FOLDER_CREATE: "created folder",
  TAG_CHANGE: "updated tags on",
  BUCKET_CREATE: "created bucket",
  BUCKET_DELETE: "deleted bucket",
  SHARE_CREATED: "shared",
  SHARE_REVOKED: "revoked share for",
  MULTIPART_ABORT: "aborted",
  VERSION_RESTORE: "restored a version of",
  VERSION_UNDELETE: "undeleted",
  VERSION_PURGE: "permanently deleted a version of",
  BUCKET_VERSIONING_ENABLE: "enabled versioning on",
  BUCKET_VERSIONING_SUSPEND: "suspended versioning on",
};

export function lastSegment(path: string): string {
  const trimmed = path.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function eventTarget(event: ActivityEventResponse): string {
  const { action, key, targetKey, bucket } = event;
  if (!key) return bucket;
  if ((action === "RENAME" || action === "MOVE") && targetKey) {
    return `${lastSegment(key)} → ${lastSegment(targetKey)}`;
  }
  return lastSegment(key);
}
```

`activity-tab.tsx` imports these instead of declaring locally. `OverviewActivityCard` imports the same.

---

## Error handling

| Surface | Error behavior |
|---|---|
| Identity card | Connection or bucket metadata missing → render fields as "—" / "Unknown". Never throws. |
| Versioning card fetch error | Card shows "Failed to load versioning status" + retry button (calls `refetch()` on the query). |
| Versioning mutation error | Existing toast pattern: `{ title: "Failed to enable", description: error.message }`. |
| Storage stats error | Inline error + `[Retry]` button. Does not toast (errors are local to the card). |
| Activity card error | Inline error message. Does not block other cards. |
| Incomplete uploads error | Silent — card just shows "Failed to load incomplete uploads." Full UI is on the Multipart tab. |
| Stats API route 500 | Standard `{ error: message }` JSON response — matches existing routes. |

---

## Testing

**`src/lib/buckets/stats-helpers.test.ts`** covers:

- `emptyAccumulator()` returns count 0, size 0, empty map
- `accumulateObjectStats` with no entries leaves acc unchanged
- `accumulateObjectStats` sums multiple objects of the same storage class
- `accumulateObjectStats` separates by storage class
- `accumulateObjectStats` treats `Size: undefined` as 0
- `accumulateObjectStats` treats `StorageClass: undefined` as `"STANDARD"`
- `summarizeStorageClasses` returns array sorted descending by `size`
- `formatBytes` for 0, B, KB, MB, GB, TB boundaries
- `formatBytes` rounds to 2 decimal places

No component tests (matches repo convention). API route is exercised via the helper tests + manual smoke.

**Manual smoke checklist** (verification before merge):

- [ ] Navigate `/buckets/<id>/<bucket>` — lands on Overview by default
- [ ] All five cards render without console errors
- [ ] Versioning Enable on a Disabled bucket → toast + pill flips to Enabled
- [ ] Versioning Suspend on an Enabled bucket → toast + pill flips to Suspended
- [ ] `Compute stats` button on a small bucket — count/size/breakdown render
- [ ] `Refresh` re-fetches; result updates
- [ ] Activity card shows last 5 events; `View all activity` opens info drawer activity tab scoped to bucket
- [ ] `Review uploads` link navigates to `?tab=multipart`
- [ ] File-browser toolbar no longer shows versioning dropdown
- [ ] File-browser "Versioning suspended" banner still appears when applicable
- [ ] Bucket card "Settings" menu opens Overview tab (not Multipart)
- [ ] As a Viewer-role user, versioning buttons hidden and "Viewer — read only" shown
