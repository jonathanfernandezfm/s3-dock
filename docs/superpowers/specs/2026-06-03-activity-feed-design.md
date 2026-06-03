# Activity feed — who uploaded/deleted what, when

**Date:** 2026-06-03
**Scope:** New `ActivityAction` enum and `ActivityEvent` Prisma model, one new helper module, one new read API route, integrations in 9 existing mutating API routes, one new query module, one new Zustand store, one new drawer component, and a trigger button in the file browser header.

## Problem

When more than one person works against the same S3 connection — a teammate, a contractor, or future-you six months later — there is no way to answer "who uploaded this", "who deleted that folder", or "what changed in this prefix today". S3 itself does not solve this:

- CloudTrail, S3 Server Access Logs, and S3 Event Notifications all record the AWS **principal** (the IAM credentials being used), not the app's users. Since teammates share one `Connection`'s credentials, every action would be attributed to the same principal regardless of who actually did it.
- They are AWS-only (or require an equivalent MinIO event-notification setup) — the app supports any S3-compatible endpoint.
- They require per-bucket or per-account configuration outside the app.

The only way to get correct per-user attribution is to log activity from inside the app, at the layer where we know which signed-in user is performing the operation.

## Decision

Write to a dedicated `activity_events` table from inside each mutating API route, after the S3 operation succeeds. Surface the data through a single read endpoint and a right-side slide-over drawer in the file browser whose content auto-scopes to the focused pane's current location.

Scope rules:

- **At bucket root** → events for the entire bucket.
- **In a folder** → events under that prefix, recursively.
- **File preview open** → events for that exact key.

Visibility is open within a workspace: both `ADMIN` and `VIEWER` roles read the feed. Personal workspaces get the feed too; it functions as a personal history with a single actor.

## Data model

```prisma
enum ActivityAction {
  UPLOAD
  DELETE
  COPY
  MOVE
  RENAME
  FOLDER_CREATE
  TAG_CHANGE
  BUCKET_CREATE
  BUCKET_DELETE
}

model ActivityEvent {
  id              String         @id @default(uuid())

  connectionId    String
  connection      Connection     @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  userId          String?
  user            User?          @relation(fields: [userId], references: [id], onDelete: SetNull)
  userDisplayName String
  userImageUrl    String?

  action          ActivityAction
  bucket          String
  key             String?
  targetKey       String?
  byteSize        BigInt?
  batchId         String?

  createdAt       DateTime       @default(now())

  @@index([connectionId, bucket, createdAt(sort: Desc)])
  @@index([connectionId, bucket, key, createdAt(sort: Desc)])
  @@index([batchId])
  @@index([userId])
  @@map("activity_events")
}
```

Add the inverse relation on `User` (`activityEvents ActivityEvent[]`) and on `Connection` (`activityEvents ActivityEvent[]`).

**Why this shape:**

- **Denormalized user identity** (`userDisplayName`, `userImageUrl`) is the standard audit-log pattern. A user can be removed, but the historic row still reads "Alice deleted X.txt". The FK `userId` is kept (nullable) so "filter by user" works for current team members and `SetNull` preserves historic rows.
- **`onDelete: Cascade` from Connection.** If a connection is deleted, its activity goes with it. Simpler v1 model; no orphan rows. If long-term retention through connection rotation matters later, the upgrade path is a `connectionName` snapshot column and switching to `SetNull` — non-destructive.
- **`key` nullable** so bucket-level events (which have no object key) live in the same table without a second model.
- **`batchId` nullable.** Single-file operations don't set it. The frontend groups consecutive rows by `(userId, action, batchId)` when `batchId !== null`.
- **One row per affected key** even for bulk ops. Per-key search ("when was config.json deleted?") stays a direct indexed lookup. The "one expandable row" UX is a render-time grouping over those rows.
- **Composite index `(connectionId, bucket, createdAt DESC)`** powers the bucket-scoped feed (newest first). The second index `(connectionId, bucket, key, createdAt DESC)` powers per-file scope. Recursive folder scope uses `key LIKE 'prefix/%'` against the first index — Postgres uses it because the leading columns match.
- **No `prefix` column.** Activity events are about specific keys (or buckets); the "folder scope" is a query filter, not stored data.

**Cross-connection copy/move:** two rows in two different connections' feeds, sharing one `batchId`. Source connection's feed shows the op with `key = sourceKey, targetKey = null`; target connection's feed shows the op with `key = targetKey, targetKey = null`. Each row stands alone on its own connection's timeline.

## Capture layer

**New file: `src/lib/db/activity.ts`**

```ts
type SingleActivityInput = {
  connectionId: string;
  userId: string;
  userDisplayName: string;
  userImageUrl: string | null;
  action: ActivityAction;
  bucket: string;
  key?: string | null;
  targetKey?: string | null;
  byteSize?: bigint | null;
};

type BatchActivityInput = Omit<SingleActivityInput, "key" | "targetKey"> & {
  items: Array<{ key: string; targetKey?: string | null }>;
};

export async function recordActivity(input: SingleActivityInput): Promise<void>;
export async function recordActivityBatch(input: BatchActivityInput): Promise<void>;
```

- Both helpers **swallow errors** and `console.error` them. Audit logging must never break the user-facing operation.
- `recordActivityBatch` generates a single `batchId` with `crypto.randomUUID()` (or accepts one for cross-connection ops) and writes via `prisma.activityEvent.createMany()`.
- `userDisplayName` is derived once at the call site from the `withAuth`-injected user: `[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email`. `userImageUrl` is whatever `user.imageUrl` is — passed verbatim, stored verbatim. Historic rows are never refreshed on profile changes.

### Routes that call the helper

Each call happens **after** the S3 operation succeeds, before the response is returned. For bulk routes that already build a `results[]` array, filter `r.success` before passing to `recordActivityBatch`.

| Route | Action | Notes |
|---|---|---|
| `POST /api/objects/upload` | `UPLOAD` | Single; `byteSize = file.size`. |
| `POST /api/objects/delete` | `DELETE` | Batch over `keys[]`. |
| `POST /api/objects/copy` | `COPY` | Batch over successful results. Cross-connection: two writes (source + target connection), same `batchId`. |
| `POST /api/objects/move` | `MOVE` | Same shape as copy. |
| `POST /api/objects/rename` | `RENAME` | Single; `key = sourceKey, targetKey = newKey`. |
| `POST /api/objects/folder` | `FOLDER_CREATE` | Single. |
| `POST /api/objects/tag` | `TAG_CHANGE` | Single per key. |
| `POST /api/buckets` | `BUCKET_CREATE` | Single; `key = null`. |
| `DELETE /api/buckets/[bucket]` | `BUCKET_DELETE` | Single; `key = null`. |

## Read API

### `GET /api/activity`

Wrapped in `withAuth`. Authorizes by `getConnectionAccessById(connectionId, user.id)` — same check every other route uses. Both `ADMIN` and `VIEWER` can read.

Query params:

| Param | Required | Notes |
|---|---|---|
| `connectionId` | yes | |
| `bucket` | yes | |
| `prefix` | no | If set, filters to `key LIKE '<prefix>%'` (recursive). Escape `%` and `_` in user input before the `LIKE`. |
| `key` | no | Exact match. Mutually exclusive with `prefix`. |
| `userId` | no | Filter to one actor. |
| `actions` | no | Comma-separated `ActivityAction` values. |
| `cursor` | no | Opaque pagination cursor returned by a previous page. Encodes `(createdAt, id)`. |
| `limit` | no | Default 50, hard-capped at 200. |

Ordering: `ORDER BY createdAt DESC, id DESC`. The `id` tiebreaker matters because `prisma.activityEvent.createMany()` can give a bulk-op's rows identical `createdAt` values; without it, a `limit` that splits a batch would skip the rest of the batch on the next page. Cursor predicate is the lexicographic `(createdAt, id) < (cursorCreatedAt, cursorId)`.

Response: flat array, newest first. `BigInt` byteSize serialized as string. Includes `nextCursor` (opaque, encodes the last row's `(createdAt, id)`) when results hit `limit`.

```ts
type ActivityEventResponse = {
  id: string;
  userId: string | null;
  userDisplayName: string;
  userImageUrl: string | null;
  action: ActivityAction;
  bucket: string;
  key: string | null;
  targetKey: string | null;
  byteSize: string | null;
  batchId: string | null;
  createdAt: string;
};
type ActivityResponse = { events: ActivityEventResponse[]; nextCursor: string | null };
```

No `POST` route exists. Events are only created from inside other route handlers, never from clients — preventing forged audit entries.

## Client query layer

**New file: `src/lib/queries/activity.ts`**

```ts
type ActivityScope = {
  connectionId: string;
  bucket: string;
  prefix?: string;
  key?: string;
  userId?: string;
  actions?: ActivityAction[];
};

useActivity(scope: ActivityScope)
  // useInfiniteQuery; pageParam = cursor; flattens pages.
  // Returns { events, hasMore, fetchNextPage, refetch, isLoading }

useInvalidateActivity()
  // Returns a callback that invalidates activityKeys.all.
```

Add `activityKeys` to `src/lib/queries/keys.ts` following the existing factory pattern.

**Invalidation wiring:** every mutation hook in `src/lib/queries/objects.ts` (`useUploadObject`, `useDeleteObjects`, `useCopyObjects`, `useMoveObjects`, `useRenameObject`, `useCreateFolder`, `useTagObject`) and the bucket mutation hooks gain one line in their `onSuccess`: invalidate `activityKeys.all`. That replaces "live updates" in v1 — your own actions refresh the panel immediately; teammates' actions show up next time the panel opens or the user hits refresh.

Stale time matches the rest of the codebase — 1 minute.

## UI

### Drawer

**New file: `src/components/activity/activity-drawer.tsx`**

A single global instance for the whole app — mounted once at the dashboard layout level (`src/app/(dashboard)/layout.tsx`), not per-pane. Open/closed state lives in a Zustand store so the drawer survives pane switches and tab changes.

- **Mount point:** dashboard layout root. Positioned absolute against the file-browser area's right edge; overlays from the right when toggled (does not push pane content). One instance, regardless of how many panes the user has open.
- **Width:** 380px when open, 0 when closed. CSS-transform slide.
- **Header:** title ("Activity"), scope subtitle (e.g. `media-prod / processed/2024/Q4/` or just `media-prod`), refresh button, close button.
- **Filter strip:** user dropdown + action checkboxes (see Filters).
- **Body:** virtualized list, newest first. Rows + collapsible batch groups.
- **Footer:** "Load older" button when `hasMore`.

**New store: `src/lib/stores/activity-drawer-store.ts`** — `{ isOpen, toggle, open, close, userFilter, actionFilter }`. Mirrors the pattern of `recent-locations-store.ts`.

**Trigger:** an Activity icon button (Lucide `Activity` or `History`) in the file browser header, between the view-mode toggle and the upload button.

### Scope resolution

The drawer always reflects the **focused pane**'s current location. The browser store already tracks `(connectionId, bucket, path[])` per pane and which pane is focused — the drawer reads the focused pane and derives the scope:

| Pane state | Scope |
|---|---|
| At bucket root (`path = []`) | `{ connectionId, bucket }` |
| In a folder (`path = ["a", "b"]`) | `{ connectionId, bucket, prefix: "a/b/" }` |
| File preview open | `{ connectionId, bucket, key: previewObject.key }` |

When the focused pane changes, the scope auto-updates. React Query caches each scope independently.

### Row rendering

A single-line row, ~52px tall:

```
[avatar 24px]  Alice deleted config.json          2m ago  [⌃ if batch]
               in processed/2024/Q4/
```

- **Avatar:** `userImageUrl` if present, otherwise initials in a deterministic color circle keyed off `userId`.
- **Action verb:** mapped from the enum (`UPLOAD → uploaded`, `RENAME → renamed`, `BUCKET_CREATE → created bucket`, ...).
- **Target:** path tail of `key` (last segment); bucket name for bucket-level events. For `RENAME`/`MOVE` shows `oldname → newname` (tails only).
- **Subline:** parent folder of the affected key, for at-a-glance context. Hidden for bucket-level events.
- **Right edge:** relative timestamp (`2m ago`, `3h ago`, `Mar 21`). Hover tooltip shows the full ISO timestamp.
- **Batch indicator:** chevron at the right edge when `batchId !== null`.

### Batch grouping

Render-time logic. Walk the flat events list newest-first; when consecutive rows share `(userId, action, batchId)` and `batchId !== null`, fold them into a collapsed parent row:

```
Alice deleted 50 files in archive/                2m ago  ▾
```

Expand reveals indented children without their own avatar/timestamp (visually one event).

### Filters

Both filters live in the filter strip and append to the query key (cheap when the same scope was already fetched).

- **User filter:** "All users" or one specific user. Choices derived client-side from currently-loaded events' `userDisplayName`s. No separate team-member endpoint.
- **Action filter:** popover with checkboxes per `ActivityAction`. Default = all selected. When some are deselected, the chip shows e.g. "Deletes only".

Filter state lives in the drawer-store and persists while the panel stays open. Closing resets it — intentional: opening fresh next time.

### Empty / loading / error states

- **First page loading:** centered spinner.
- **Empty:** "No activity yet for this *location*". Filtered empty: "No activity matches the current filters" with a "Clear filters" link.
- **Error:** "Couldn't load activity" with a Retry button.
- **Personal workspace:** identical rendering. No special copy.

## Edge cases

| Scenario | Behavior |
|---|---|
| `recordActivity` throws after a successful S3 op | Helper swallows + logs. User-facing operation still returns success. One missing audit row is acceptable; failing a successful delete because we couldn't log it is not. |
| Partial-success bulk op | Only successful keys get rows. The route already returns per-key `results[]` — filter on `r.success` before passing to `recordActivityBatch`. Group header reflects the actual count ("47 files" not "50 attempted"). Failures surfaced by the existing operation-result toast. |
| `VIEWER` role on the connection | Can read `/api/activity` and open the drawer. Can't trigger mutating routes, so writes nothing. |
| User loses access mid-session | `GET /api/activity` returns 404 via `getConnectionAccessById`. Drawer shows the error state until the user navigates away. |
| Connection deleted | Cascade removes all the connection's `ActivityEvent` rows. Pane is already navigating elsewhere by then. |
| User deleted (left the team) | `userId` → `null` via `onDelete: SetNull`. Historic rows still display `userDisplayName`. User-filter dropdown stops listing them (it's derived from currently-loaded events). |
| Bucket externally deleted (S3 console) | Activity rows remain — no S3-state garbage collection. The bucket-listing layer fails before the drawer fetches. |
| Same file uploaded by two users in quick succession | Two separate rows, different `userId`, no `batchId`, no collapse. |
| Rename within the same folder | One row, `key = oldKey, targetKey = newKey`. Renders as `oldname → newname`. |
| Cross-connection copy/move | Two rows in two feeds, shared `batchId`. Each is `targetKey = null` on its own connection's timeline; the path shown is whichever side of the op happened on that connection. |
| `batchId` collisions across users | Impossible — `crypto.randomUUID()` is the source. Frontend grouper requires matching `userId` AND `action` AND `batchId`. |
| User changes name or avatar | Historic rows keep the old snapshot. Intentional — audit log shows what was true at the time. |
| Personal workspace | Same code path; user filter dropdown shows one name. No special UI. |
| DB pressure causes activity writes to fail | Operation already returned success. Some rows may be missing during incidents. No retry queue in v1. |

## Out of scope (v1)

Captured here so the next person extending the feature does not have to re-derive what was considered and deferred:

- **Click row → navigate to file or folder.** Makes the feed actionable, but adds dead-target handling (deleted file, renamed folder) and navigation plumbing. Deferred to v2.
- **Live auto-refresh (polling or SSE).** Replaced in v1 by query-invalidation on the user's own mutations + a manual refresh button. Real-time push only matters when teammates are actively co-editing; not the common case.
- **External-change detection via S3 event notifications / CloudTrail.** Only useful for AWS S3 and requires per-bucket configuration outside the app. Wouldn't give per-user attribution because all teammates share one set of credentials.
- **Tier-based retention caps (FREE 30d, PRO 1y, ENTERPRISE ∞).** The subscription model is already in place to support this. v1 stores forever; a cleanup job + per-user TTL can be added without a destructive migration.
- **Read operations (downloads, listings, previews).** Significantly more volume; arguably privacy-sensitive in team settings. Audit value is lower than write events. Adding later only needs new enum values + new route hooks.
- **Activity exports (CSV / JSON download).** Useful for compliance reporting. Easy to add later: a new `GET /api/activity/export` route reading the same data.
- **Per-pane independent drawers in split view.** v1 has one global drawer that follows the focused pane. Per-pane would mean a second store key per pane + rerendering when both panes have the drawer open. Not worth the complexity yet.
- **"X new events since you last looked" badge** on the trigger button. Requires tracking a per-user last-seen-cursor server-side or in local storage.
- **Email / Slack notifications** for activity events (e.g. "your file was deleted"). A different feature surface — channels integration, per-user subscription preferences, digest scheduling.
- **Snapshot of `connectionName` on each row.** Today cascade-on-delete removes the audit trail when a connection is deleted. Adding a denormalized `connectionName` column + switching to `onDelete: SetNull` preserves long-term history through connection rotation. Migration is additive.
- **Click-to-restore for deletes / undo.** v1 just records the event; it doesn't keep the bytes. S3 versioning would be the right substrate if this ever ships.
- **Sharing / commenting on activity entries.** Out of scope for an audit log; belongs in a different feature.
- **Server-side aggregation** ("Alice did 17 actions today"). The data supports it; no UI in v1.
- **Activity for connection/workspace-level events** (connection created, member added to team). Different blast radius and access semantics; would belong in a separate workspace-activity feed.

## Implementation order

Each step is independently testable; visible UI begins at step 10.

1. Prisma schema — `ActivityAction` enum and `ActivityEvent` model. Add inverse relations on `User` and `Connection`. `prisma migrate dev --name add-activity-events`.
2. `src/lib/db/activity.ts` — `recordActivity` and `recordActivityBatch` with error swallowing.
3. Wire `POST /api/objects/upload` to call the helper.
4. Wire `POST /api/objects/delete` (batch).
5. Wire `POST /api/objects/copy` and `POST /api/objects/move` (batch, cross-connection).
6. Wire `POST /api/objects/rename`, `POST /api/objects/folder`, `POST /api/objects/tag`, `POST /api/buckets`, `DELETE /api/buckets/[bucket]`.
7. `GET /api/activity` with query params, authorization, and cursor pagination.
8. `src/lib/queries/activity.ts` + `activityKeys` + `useInvalidateActivity` wiring into existing mutation hooks.
9. `src/lib/stores/activity-drawer-store.ts`.
10. `src/components/activity/activity-drawer.tsx` — chrome, scope subtitle, refresh, close, loading / empty / error states. Placeholder rows.
11. Row component + batch grouping logic.
12. Filter strip (user dropdown + action checkboxes).
13. Mount drawer at `src/app/(dashboard)/layout.tsx` (one global instance). Add the trigger button in the file browser header (`src/components/browser/file-browser.tsx`).
