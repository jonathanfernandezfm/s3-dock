# Object Versioning & Version History Browser — Design

**Date:** 2026-06-05
**Scope:** New feature. Adds bucket-versioning controls plus a browser for inspecting, restoring, undeleting, and purging individual object versions on versioned S3 buckets.

## Problem

S3 supports per-object versioning natively: every PUT to a versioned bucket keeps the prior version, and every DELETE writes a "delete marker" instead of erasing data. In practice, this is one of the most valuable S3 features for non-disaster recovery — accidental overwrites and accidental deletes are both reversible.

The AWS Console technically exposes versioning, but the workflow is painful:

- The "Show versions" toggle is a per-page state that scrolls the user into a flat list of every version of every object, sorted in an order that's never quite what you want.
- Restoring an old version is a multi-step copy operation the user has to construct by hand (copy with source-version ID into the same key).
- Recovering a deleted file requires understanding delete markers, which the UI surfaces as one more row in the same list.
- There's no preview of a specific old version, no diff between two versions, no one-click anything.

For most users, "I want to get yesterday's version of `pricing.xlsx` back" is a 5-minute scavenger hunt with three opportunities to permanently destroy the wrong thing. It shouldn't be.

## Decision

Add a first-class **version history browser**:

- A "Versions" tab in the existing info drawer that adapts to scope (file, folder, or bucket).
- A dedicated **Version history dialog** for single files, with preview, download-per-version, diff between two text versions, copy-to-elsewhere, restore (copy-forward), and admin-gated permanent purge.
- Bucket-level **versioning toggle** in the bucket page header, admin-only, with a small badge in the bucket list when versioning is enabled.

Everything is built on AWS SDK primitives: `ListObjectVersions`, `CopyObject` (with `?versionId=…` in `CopySource`), `DeleteObject` (with `VersionId`), `GetBucketVersioning`, `PutBucketVersioning`. The novelty is in the UX wrapping, not the underlying mechanics.

### Restore semantics

"Restore" is **copy-forward**: it issues `CopyObject` from the selected old version to the same key, which writes a new latest version with the old version's content. Newer versions are preserved in history. Matches AWS Console behaviour and `git revert` semantics. Non-destructive by design.

### Permission model

| Action | Required role |
|---|---|
| List versions | Any role with read access (matches list objects) |
| Restore (copy-forward) | Any role with write access (matches upload) |
| Undelete (remove a delete marker) | Any role with write access (it's not destructive — the delete marker is the only thing removed) |
| Download / preview a specific version | Any role with read access |
| Copy a specific version to another path/bucket | Write access on both connections |
| Permanent purge (`DeleteObject` with `VersionId` on a real version) | **ADMIN** |
| Toggle bucket versioning Enabled / Suspended | **ADMIN** |

Each mutation gates server-side in the API route via `getConnectionAccessById(...).role` (existing pattern in `/api/objects/delete/route.ts`, `/api/buckets/route.ts`).

## Out of scope (v1)

- Lifecycle policies (managing the rules that auto-expire old versions).
- MFA delete configuration. We surface `mfaDeleteEnabled` as a read-only field but don't manage it.
- Pagination beyond the first 1000 entries. The list endpoint supports the SDK's `KeyMarker` / `VersionIdMarker` continuation, but the UI only renders the first page and surfaces a "Load more" button when `isTruncated`.
- End-to-end tests against real S3.
- Activity tab event grouping for version operations (events are emitted; visual grouping comes later).

## Architecture

Versions are modeled as a parallel concept to objects, with their own types, API routes, and React Query hooks. This mirrors how `share-links`, `notes`, and `bookmarks` are organized in the codebase — each is a focused vertical slice, kept separate from the base object/bucket primitives.

Data flow follows the existing app pattern:

```
PostgreSQL (activity log only)
        ↑
  API routes ─→ AWS SDK ─→ S3
        ↑
  React Query hooks
        ↑
  Components + zustand store
```

No bucket-versioning or version state is mirrored to PostgreSQL. Versioning state is read live from S3 (cached by React Query), so external changes (CLI, other tools, lifecycle policies) stay accurate.

## Data model

### TypeScript types

Added to `src/types/s3.ts`:

```ts
export type BucketVersioningStatus = "Enabled" | "Suspended" | "Disabled";

export interface S3BucketVersioning {
  status: BucketVersioningStatus;
  mfaDeleteEnabled: boolean;
}

export interface S3ObjectVersion {
  key: string;
  versionId: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
  lastModified?: Date;
  size?: number;
  etag?: string;
  storageClass?: string;
  owner?: { id?: string; displayName?: string };
}

export interface ListObjectVersionsResponse {
  versions: S3ObjectVersion[];
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
}
```

`S3ObjectVersion` normalizes the SDK's separate `Versions[]` and `DeleteMarkers[]` arrays into one chronological per-key timeline. Normalization happens at the API boundary so the client deals with one shape.

### Activity events

New values added to the `ActivityAction` enum in `prisma/schema.prisma`:

```
VERSION_RESTORE
VERSION_UNDELETE
VERSION_PURGE
BUCKET_VERSIONING_ENABLE
BUCKET_VERSIONING_SUSPEND
```

Each gets a matching entry in `ACTION_VERBS` and `ACTION_LABELS` in `src/components/info-drawer/activity-tab.tsx`. Requires a Prisma migration.

## API routes

All routes match the existing pattern: `withAuth`, `getConnectionAccessById`, role gate where applicable, `createS3Client`, optional `recordActivity` on mutations.

### Object-version routes (`src/app/api/objects/versions/`)

```
POST /api/objects/versions          → list versions in a prefix or for a key
POST /api/objects/versions/restore  → copy-forward a version to make it latest
POST /api/objects/versions/undelete → remove a delete marker
POST /api/objects/versions/purge    → permanently delete one version (ADMIN)
POST /api/objects/versions/presign  → presigned GetObject URL for a specific versionId
POST /api/objects/versions/copy     → copy a specific version to another key/bucket
```

### Bucket-versioning routes (`src/app/api/buckets/[bucket]/versioning/`)

```
GET  /api/buckets/[bucket]/versioning  → read S3 versioning status
PUT  /api/buckets/[bucket]/versioning  → set Enabled or Suspended (ADMIN)
```

### Request/response shapes

#### `POST /api/objects/versions`

```ts
// Body
{ connectionId: string; bucket: string; prefix?: string; key?: string;
  keyMarker?: string; versionIdMarker?: string; maxKeys?: number }
```

When `key` is set, the SDK call uses `Prefix: key` and the server filters to only that exact key. When `prefix` is set, returns versions under that prefix. Returns `ListObjectVersionsResponse`.

#### `POST /api/objects/versions/restore`

```ts
// Body
{ connectionId: string; bucket: string; key: string; versionId: string }
```

Server issues:
```ts
CopyObject({
  Bucket: bucket,
  Key: key,
  CopySource: `${bucket}/${encodeURIComponent(key)}?versionId=${versionId}`,
})
```

Records `VERSION_RESTORE` activity with `{ sourceVersionId: versionId }` metadata. Returns `{ success: true, newVersionId: <CopyObjectResult.VersionId> }`.

#### `POST /api/objects/versions/undelete`

```ts
// Body
{ connectionId: string; bucket: string; key: string; deleteMarkerVersionId: string }
```

Server issues `DeleteObject({ Bucket, Key, VersionId: deleteMarkerVersionId })`. Removing a delete marker resurrects the object (the previous version becomes latest again). Permission: any role with write access. Records `VERSION_UNDELETE` activity.

#### `POST /api/objects/versions/purge` (ADMIN)

```ts
// Body
{ connectionId: string; bucket: string; key: string; versionId: string }
```

Server issues `DeleteObject({ Bucket, Key, VersionId })`. Records `VERSION_PURGE` with `{ versionId }` metadata. Returns `{ success: true }`.

#### `POST /api/objects/versions/presign`

```ts
// Body
{ connectionId: string; bucket: string; key: string; versionId: string; downloadFilename?: string }
```

Returns `{ url }` — a presigned `GetObject` URL with `?versionId=…`, valid 1h. Used by both preview and download. When `downloadFilename` is set, the URL includes `ResponseContentDisposition=attachment; filename=…`.

#### `POST /api/objects/versions/copy`

```ts
// Body
{ connectionId: string; bucket: string; key: string; versionId: string;
  targetBucket: string; targetKey: string }
```

Server issues `CopyObject({ Bucket: targetBucket, Key: targetKey, CopySource: <source>?versionId=<versionId> })`. Permission: write access on both source and target connections (call `getConnectionAccessById` for both). Records `COPY` activity with `{ sourceVersionId }` metadata.

#### `GET /api/buckets/[bucket]/versioning`

Query: `?connectionId=...`. Server issues `GetBucketVersioning`. Returns `S3BucketVersioning`. If S3 has never had versioning enabled for the bucket, status is `"Disabled"`.

#### `PUT /api/buckets/[bucket]/versioning` (ADMIN)

```ts
// Body
{ connectionId: string; enabled: boolean }
```

`enabled: true` → `PutBucketVersioning({ Status: "Enabled" })`. `enabled: false` → `Status: "Suspended"`. Records `BUCKET_VERSIONING_ENABLE` or `BUCKET_VERSIONING_SUSPEND` activity. Returns `{ success: true, status }`.

Note: S3 has no transition back to `"Disabled"` once versioning has ever been enabled. The UI surfaces this — only Enabled ↔ Suspended is offered.

## UI surfaces

### Versions drawer tab (`src/components/info-drawer/versions-tab.tsx`)

A third tab next to Activity and Notes, with a `History` icon. Reads `scope` from `useInfoDrawerStore` and adapts:

- **File scope** (`scope.objectKey` set) — compact list of that one key's versions, newest first. Each row: `v<n>` label, `current`/`deleted` badge where applicable, size, relative time, three-dot action menu (Restore · Download · Open full view · Copy to… · Delete forever [ADMIN]).
- **Folder scope** (`scope.prefix` set, no `objectKey`) — versions and delete markers under the prefix, grouped by key, each group collapsed by default. Top of list: filter chips `[All]` `[Deleted only]` `[Older versions]`.
- **Bucket scope** (no scope, drawer opened on bucket root) — same shape as folder scope with empty prefix. `Deleted only` is the highest-value default filter at this level.

`InfoDrawerTab` type in `info-drawer-store.ts` gets `"versions"` added. Tab strip in `info-drawer.tsx` gets a third tab.

### Version history dialog (`src/components/versions/version-history-dialog.tsx`)

Triggered from:
- File row context menu → "Version history"
- File row context menu → "Restore previous version" (opens with the most recent non-current version preselected)
- Drawer Versions tab in file scope → "Open full view"
- Command palette (future entry; this v1 wires the store so it's trivial)

Layout: split pane.

- **Left rail (versions list)**: virtualized, latest at top. Each row has a checkbox (for diff selection) and is single-click-selectable (selection drives the preview pane and action bar). Delete markers render as a distinct row style with "Deleted by X" subline and an inline "Undelete" button instead of the standard action bar.
- **Right pane (preview)**: renders the selected version via the existing preview infrastructure (`src/lib/preview/`, `src/components/preview/`), fed the presigned versioned URL from `useVersionPresignUrl`. When two checkboxes are ticked and both versions are diffable, the preview pane swaps to a side-by-side diff view (text only, ≤1 MB per side; uses the `diff` npm package).
- **Action bar (below the right pane)**: `Restore` (primary), `Download`, `Copy to…` (opens a target picker reusing existing connection/bucket selector logic), and an overflow menu containing `Delete forever` (ADMIN-only, opens typed-name confirmation reusing the `delete-confirm-dialog.tsx` pattern).
- **Empty state**: "No older versions yet." with a hint about how versioning works. Shown when the list has only the current version.

#### Diff guardrails

The "Diff selected" affordance is only enabled when:
- Exactly 2 checkboxes are ticked,
- Neither selection is a delete marker,
- Each side's `size` is ≤ 1 MB (1,048,576 bytes),
- Each side's content type is `text/*` or its extension is in a known text-extension allowlist (`.md`, `.json`, `.yaml`, `.yml`, `.csv`, `.txt`, `.log`, `.js`, `.ts`, `.tsx`, `.jsx`, `.css`, `.html`, `.xml`, `.sql`, `.sh`, `.py`, `.go`, `.rs`, `.java`, `.kt`).

Otherwise the button is disabled with a tooltip explaining the constraint that failed.

### Bucket versioning controls

- **Bucket card badge** (`src/components/buckets/bucket-card.tsx`): when status is `Enabled`, render a subtle `History` icon next to the bucket title. Tooltip: "Versioning enabled".
- **Browser page toolbar** (`src/app/(dashboard)/browser/[connectionId]/[bucket]/[[...path]]/page.tsx`): a `[Versioning ▾]` dropdown showing the current status. ADMIN users get a toggle between Enabled and Suspended. Non-ADMIN sees the status as a static label. When status is `Suspended`, an info banner above the file list reads: "Versioning suspended — new uploads won't be versioned. Existing versions are preserved."
- Entry points to the Versions tab/dialog are **only rendered** when the bucket's versioning is `Enabled` or `Suspended`. Never-versioned buckets don't show any version-related UI affordances — avoids surfacing UI that does nothing.

### State management

#### Query keys (additions to `src/lib/queries/keys.ts`)

```ts
versions: {
  all: ["versions"] as const,
  list: (connectionId, bucket, prefix, key) =>
    [...queryKeys.versions.all, connectionId, bucket, prefix, key] as const,
},
bucketVersioning: {
  all: ["bucket-versioning"] as const,
  status: (connectionId, bucket) =>
    [...queryKeys.bucketVersioning.all, connectionId, bucket] as const,
},
```

#### Hooks (`src/lib/queries/versions.ts`)

- `useObjectVersions(connectionId, bucket, { prefix?, key? })` — `useQuery`, returns `ListObjectVersionsResponse`. Enabled when `useBucketVersioning(...).status` is `Enabled` or `Suspended`.
- `useRestoreVersion()` — `useMutation`. On success invalidates `queryKeys.versions.all`, `queryKeys.objects.all`, and activity.
- `useUndeleteVersion()` — `useMutation`. Same invalidations.
- `usePurgeVersion()` — `useMutation`. Invalidates `queryKeys.versions.all` and activity.
- `useCopyVersion()` — `useMutation`. Invalidates `queryKeys.objects.all` (for the target prefix) and activity.
- `useVersionPresignUrl(connectionId, bucket, key, versionId, opts?)` — `useQuery`, 50-minute stale time (URL is valid 60 min). Disabled until consumer reads.

#### Hooks (additions to `src/lib/queries/buckets.ts`)

- `useBucketVersioning(connectionId, bucket)` — `useQuery`, returns `S3BucketVersioning`.
- `useSetBucketVersioning()` — `useMutation`. Invalidates `bucketVersioning.status`, `versions.all`, and activity.

#### Store (`src/lib/stores/version-history-dialog-store.ts`)

```ts
type VersionHistoryTarget = { connectionId: string; bucket: string; key: string };

interface VersionHistoryDialogState {
  isOpen: boolean;
  target: VersionHistoryTarget | null;
  selectedVersionId: string | null;
  diffSelection: string[];  // 0–2 versionIds
  open: (target: VersionHistoryTarget) => void;
  close: () => void;
  selectVersion: (versionId: string | null) => void;
  toggleDiffSelection: (versionId: string) => void;
  clearDiffSelection: () => void;
}
```

A store (rather than local component state) means any component — file row, drawer button, command palette, future keyboard shortcuts — can trigger the dialog without prop drilling. Same pattern as `upgrade-modal-store`, `info-drawer-store`, etc.

#### Drawer store change

In `src/lib/stores/info-drawer-store.ts`: extend `InfoDrawerTab` to `"activity" | "notes" | "versions"`. No other structural change — `scope` already drives the existing tabs the way the Versions tab needs.

## Error handling

| Scenario | Behavior |
|---|---|
| Bucket not versioned | List API returns `{ versions: [], reason: "not_versioned" }`. Drawer/dialog renders empty state: "This bucket has no version history. Enable versioning to start tracking changes." (ADMIN gets an inline `Enable` button.) |
| Versioning suspended mid-session | `useBucketVersioning` is invalidated on mutations and on focus. If status flips to `Disabled` while the dialog is open, the dialog stays open (browsing is still useful) but Restore/Copy are disabled with a tooltip explaining why. |
| Restore conflict (concurrent write) | No special handling. Restore is intentionally "create a new version from this old one." Race is benign — the concurrent uploader's version remains in history, restore becomes the new latest. |
| Purge of the current latest version | S3 promotes the next-newest non-delete-marker version to latest. We invalidate `versions.all` *and* `objects.all` so the file row reflects the change in size/modified date. |
| Diff too large or non-text | The "Diff selected" button is disabled at the UI level (see guardrails above) — we never attempt to fetch and bail. Tooltip explains the constraint. |
| Cross-connection copy permission denial | API returns 403; surfaced as a toast: "You don't have permission to copy to that connection." |
| Restore success | Toast: "Restored to v<n> (now latest)." with an **Undo** button — clicking Undo restores the previous-latest version. Adds no new endpoint; reuses `useRestoreVersion`. |
| Permanent purge | Typed-name confirmation modal (must type the file name) before the request. No undo, and we say so. |
| Undelete success | Toast: "Restored deleted file." Drawer and objects list refresh. |
| Loading | Skeleton rows in drawer and dialog while versions load. Reuse the skeleton patterns used in `file-list.tsx`. |

## Testing strategy

Three layers, all using Vitest (`pnpm test`).

### Unit tests (pure logic)

- `src/lib/versions/normalize.test.ts` — merging `Versions[]` and `DeleteMarkers[]` into one sorted `S3ObjectVersion[]`. Covers: merge ordering, isLatest marking, per-key grouping, `versionId="null"` passthrough, empty input.
- `src/lib/versions/can-diff.test.ts` — the diff-guard predicate. Covers: 2 text under 1MB → true; either side >1MB → false; binary content type → false; ≠2 selections → false; missing content-type with text extension fallback → true.
- `src/lib/versions/permissions.test.ts` — small role-gate helper used by both UI (to render/hide buttons) and API (defense in depth). Covers each role × each action.

### API route integration tests

Each API route gets a colocated `route.test.ts` that mocks `@aws-sdk/client-s3` via `vi.mock`. Every route covers: happy path, missing required fields → 400, unknown connection → 404, insufficient role → 403, S3 error → 500 with passthrough message.

Plus route-specific assertions:

- `versions/route.ts`: list with `key` returns only that key's versions; list with `prefix` returns versions grouped by key; response normalizes both SDK arrays.
- `versions/restore/route.ts`: uses `CopyObject` with `versionId` in `CopySource`; records `VERSION_RESTORE` activity with `sourceVersionId`; returns `newVersionId`.
- `versions/undelete/route.ts`: deletes the specified delete-marker versionId; records `VERSION_UNDELETE`; write user (not admin) succeeds.
- `versions/purge/route.ts`: requires ADMIN; deletes the specified versionId; records `VERSION_PURGE` with metadata.
- `versions/presign/route.ts`: generates `GetObject` presigned URL with `VersionId`; respects optional `downloadFilename` via `ResponseContentDisposition`.
- `versions/copy/route.ts`: uses `CopyObject` with source `versionId`, writes to target bucket/key; requires write access on both connections.
- `buckets/[bucket]/versioning/route.ts`: GET returns the three statuses correctly; PUT requires ADMIN; PUT `enabled:true` sends `Status: Enabled`; PUT `enabled:false` sends `Status: Suspended`; PUT records the matching activity action.

### UI component tests

- `src/components/versions/version-history-dialog.test.tsx`: renders empty state with one version; selecting a version updates preview/action bar; two-version selection enables Diff when both text; Diff disabled with tooltip when binary/oversized; Restore confirm calls `useRestoreVersion` with correct `versionId`; Delete forever requires typed filename and is ADMIN-only; delete-marker row shows Undelete instead of action bar.
- `src/components/info-drawer/versions-tab.test.tsx`: file scope renders single-key timeline; folder scope renders grouped/collapsed; "Deleted only" chip filters to delete markers; "Open full view" opens the dialog with the correct target; empty state when bucket not versioned.

## Open questions

- Whether to gate the feature behind a paid tier. The codebase has `useTier`; existing features (`share-links`, `notes`) make tier decisions independently. Leaving the gating decision to whoever scopes the v1 launch.
- Whether `VERSION_*` activity events should get custom grouping in the activity tab (analogous to the existing batch grouping). Deferred — emit the events now; group later if the activity tab gets noisy.
