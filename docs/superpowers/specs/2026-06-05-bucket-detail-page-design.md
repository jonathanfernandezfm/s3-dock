# Bucket Detail Page Design

**Date:** 2026-06-05
**Status:** Approved
**Headline value:** Surface incomplete (abandoned) multipart uploads — a hidden cost leak in S3 — and let admins abort them in bulk. Land this inside a tabbed bucket detail page that frames the roadmap for overview, lifecycle, and permissions tabs to follow.

---

## Goal

Give users a per-bucket management surface where they can manage things S3 hides from the file browser. The first thing it surfaces is **incomplete multipart uploads** — partial data left behind by interrupted uploads that AWS keeps charging for indefinitely.

## Non-goals (v1)

- No size/cost calculation per upload. `ListMultipartUploads` does not return size, and computing it requires one `ListParts` round-trip per upload. Skipped for v1 — age + key are enough to decide what to abort. Can be added later if users ask.
- No lifecycle rule writer. The AWS recommendation is to install a rule that auto-aborts uploads older than N days. We're shipping manual cleanup only in v1; lifecycle is framed as a future tab.
- No paginated upload list UI. Server fetches all pages of `ListMultipartUploads` in one shot. If real buckets have thousands of abandoned uploads, revisit.
- No versioning tab. Out of scope.
- No e2e tests. Unit tests for pure helpers; API route tests with mocked AWS SDK.

---

## User-facing behavior

### Entry points

1. **Bucket card dropdown** (`/buckets`): add "Bucket settings" menu item between "Browse" and "Delete".
2. **File browser breadcrumb**: small settings-gear icon next to the bucket name in the breadcrumb, linking to the detail page.

Both link to `/buckets/[connectionId]/[bucket]?tab=multipart`.

### Page layout

- **Header**: bucket name + breadcrumb back to `/buckets`, plus a tab bar.
- **Tabs (declared in one place):**
  | Tab key | Label | v1 status |
  |---|---|---|
  | `overview` | Overview | Placeholder — "Coming soon: bucket size, object count, region, storage-class breakdown" |
  | `multipart` | Incomplete uploads | **Built** |
  | `lifecycle` | Lifecycle rules | Placeholder — "Coming soon: configure auto-deletion and storage-class transitions" |
  | `permissions` | Permissions | Placeholder — "Coming soon: bucket policy and public access settings" |

- **Default tab on landing**: `multipart` (the only working tab in v1; switch to `overview` when that lands).
- Active tab tracked via `?tab=` URL param so links are shareable and back/forward works.

### Incomplete uploads tab — states

| State | UI |
|---|---|
| Loading | Centered spinner |
| Error | `AlertCircle` + error message + Retry button |
| Empty (no uploads) | Green check + "All clear — no incomplete uploads" + one-line explainer about what these are and why they cost money |
| Populated | Table (see below) + sticky bulk-actions bar when ≥1 row selected |

### Table columns

| Column | Source | Notes |
|---|---|---|
| ☐ | Local selection state | Header checkbox = select all on current page |
| Key | `Upload.Key` | Truncate with title on hover |
| Initiated | `Upload.Initiated` | Format: `Oct 3, 2025 (8 months ago)` |
| Storage class | `Upload.StorageClass` | `STANDARD` / `STANDARD_IA` / etc. |
| Initiator | `Upload.Initiator.DisplayName` or `.ID` | Display name preferred, fall back to ID |
| Actions | — | `[Abort]` button per row |

**Default sort:** oldest first (worst cost offenders surface immediately).

### Bulk actions bar

Sticky at top of the table panel when selection is non-empty:

```
3 selected   [Abort selected]   [Clear selection]
```

### Abort confirmation dialog

```
Abort N incomplete upload(s)?

This permanently deletes the partial data.
If an upload is still in progress, it will fail.

[Cancel]  [Abort]   ← destructive variant
```

Same dialog for single-row abort (N=1) and bulk abort.

### Permissions

- **ADMIN role only** can abort. Matches existing bucket create/delete pattern.
- Non-admins see the tab read-only: table renders, but Abort buttons and bulk bar are disabled with a tooltip "You don't have permission to abort uploads for this connection."

### Activity log

- New action: `MULTIPART_ABORT`.
- Recorded **once per batch** with the count and bucket — not one record per upload, which would spam the activity feed.
- Record fields: `connectionId`, `userId`, `userDisplayName`, `userImageUrl`, `action: "MULTIPART_ABORT"`, `bucket`, `metadata: { count: N }`.

---

## Architecture

### Route structure

```
/buckets                                  ← existing: split-view bucket grid
/buckets/[connectionId]/[bucket]          ← NEW: bucket detail page (this design)
/browser/[connectionId]/[bucket]/...      ← existing: file browser
```

The detail page is a regular dashboard route — uses the existing `(dashboard)/layout.tsx` (sidebar + header + drawer). It does NOT live inside the split-view system; that's intentional, to keep the URL stable and avoid coupling to pane/tab state.

### Data flow

```
BucketCard or Breadcrumb
    → navigate /buckets/[conn]/[bucket]?tab=multipart
        → page reads URL params, mounts BucketDetailTabs
            → MultipartUploadsTab mounts
                → useIncompleteUploads(conn, bucket)
                    → POST /api/buckets/[bucket]/multipart-uploads { connectionId }
                        → withAuth → getConnectionAccessById → ListMultipartUploadsCommand (all pages)
                        → returns IncompleteUpload[]
                → render table
            → user selects + clicks Abort
                → confirmation dialog
                → useAbortUploads.mutate({ connectionId, uploads: [{key, uploadId}, ...] })
                    → DELETE /api/buckets/[bucket]/multipart-uploads { connectionId, uploads }
                        → withAuth → assert role=ADMIN → for each upload: AbortMultipartUploadCommand
                        → recordActivity({ action: "MULTIPART_ABORT", count })
                        → returns [{ key, uploadId, success, error? }, ...]
                → invalidate React Query cache
                → notify on failures
```

### API endpoints

Mirror existing `/api/buckets` style (POST for read so we can pass `connectionId` in body):

#### `POST /api/buckets/[bucket]/multipart-uploads`

**Request body:**
```ts
{ connectionId: string }
```

**Response:**
```ts
Array<{
  key: string;
  uploadId: string;
  initiated: string;       // ISO timestamp
  storageClass: string;    // "STANDARD" | "STANDARD_IA" | ...
  initiatorDisplayName: string | null;
  initiatorId: string | null;
}>
```

**Auth:** any role with access to the connection (read).
**Implementation:** loop `ListMultipartUploadsCommand` with `KeyMarker`/`UploadIdMarker` until `IsTruncated === false`, flatten results.

#### `DELETE /api/buckets/[bucket]/multipart-uploads`

**Request body:**
```ts
{
  connectionId: string;
  uploads: Array<{ key: string; uploadId: string }>;
}
```

**Response:**
```ts
{
  results: Array<{
    key: string;
    uploadId: string;
    success: boolean;
    error?: string;
  }>;
}
```

**Auth:** ADMIN role required.
**Implementation:** for each upload, call `AbortMultipartUploadCommand({ Bucket, Key, UploadId })`, catch per-upload errors, collect results. Call `recordActivity` once with `count = successful.length` if at least one succeeded.

### Files

#### New files

| Path | Responsibility |
|---|---|
| `src/app/api/buckets/[bucket]/multipart-uploads/route.ts` | POST (list) + DELETE (batch abort) |
| `src/app/(dashboard)/buckets/[connectionId]/[bucket]/page.tsx` | Bucket detail page shell; reads `?tab=` |
| `src/components/buckets/bucket-detail-header.tsx` | Title, breadcrumb back to `/buckets`, tab nav |
| `src/components/buckets/bucket-detail-tabs.tsx` | Tab definitions (one array) + active-tab renderer |
| `src/components/buckets/multipart-uploads-tab.tsx` | Table + selection state + bulk bar |
| `src/components/buckets/multipart-uploads-table.tsx` | Pure presentational table (rows, sort, selection) |
| `src/components/buckets/abort-uploads-dialog.tsx` | Confirmation dialog (handles N=1 and N>1) |
| `src/components/buckets/coming-soon-tab.tsx` | Shared placeholder content for unbuilt tabs |
| `src/lib/queries/multipart-uploads.ts` | `useIncompleteUploads` + `useAbortUploads` React Query hooks |
| `src/lib/buckets/multipart-helpers.ts` | Pure helpers: sort, format age — testable |
| `src/lib/buckets/multipart-helpers.test.ts` | Unit tests for helpers |

#### Modified files

| Path | Change |
|---|---|
| `src/components/buckets/bucket-card.tsx` | Add "Bucket settings" `DropdownMenuItem` between Browse and Delete |
| `src/components/browser/breadcrumb.tsx` | Add settings-gear `Link` icon next to bucket name |
| `src/lib/queries/keys.ts` | Add `multipartUploads.byBucket(connectionId, bucket)` |
| `src/types/index.d.ts` | Add `IncompleteUpload` type |
| `prisma/schema.prisma` | Add `MULTIPART_ABORT` to `ActivityAction` enum |

Plus a Prisma migration generated by `pnpm prisma migrate dev --name add_multipart_abort_action`.

### Component boundaries

- `multipart-uploads-tab.tsx`: stateful — owns selection state, dialog open state, mutation hook. Renders table + bulk bar + dialog.
- `multipart-uploads-table.tsx`: pure presentational — receives `uploads`, `selectedIds`, `onToggle`, `onAbortRow`, `canAbort`. Easy to test by props.
- `abort-uploads-dialog.tsx`: pure presentational — receives `open`, `count`, `onConfirm`, `onCancel`, `isPending`.
- `multipart-helpers.ts`: pure functions — `sortUploadsByInitiated`, `formatAge`, `formatInitiator`. Unit-tested.

This split mirrors how `bucket-list.tsx` (stateful) + `bucket-list-helpers.ts` (pure, tested) are organized.

---

## Error handling

- **List endpoint fails** (e.g., expired creds, network): React Query surfaces the error; tab shows error state with Retry.
- **Single abort fails inside a batch**: other aborts still run. Result array reports per-upload outcome. Frontend renders a notification per failed upload using the existing `useNotificationStore` pattern; refreshes the list.
- **All aborts in a batch fail**: same — list refreshes, notifications fire, dialog closes.
- **Permission errors** (caller is not ADMIN): API returns 403; UI should not have allowed the click in the first place (button disabled by role check) but defensively show the error notification.
- **S3 returns `NoSuchUpload`** (upload was already aborted/completed externally): treat as success — the user's intent was "make it not exist" and it doesn't exist anymore.

---

## Testing

| Layer | What | How |
|---|---|---|
| Pure helpers | `sortUploadsByInitiated`, `formatAge`, `formatInitiator` | Unit tests in `multipart-helpers.test.ts` |
| API route | List endpoint returns flattened pages; DELETE iterates and records activity once | API route tests with `@aws-sdk/client-s3` mocked at the command level (see how other routes are tested — fall back to integration if no prior pattern exists) |
| Components | Table renders rows, selection, disabled-when-not-admin | Component tests via existing testing setup (check what tests exist for `bucket-list` first; mirror that) |
| Manual verification | Page loads with real S3, abort actually removes uploads, activity log records correctly | Run dev server, point at a real connection that has incomplete uploads (or create some with multipart-create-only) |

---

## Open items (deliberately deferred)

- **Size per upload**: requires `ListParts` per row. Add as on-demand button later if asked.
- **Lifecycle auto-rule installer**: belongs in the Lifecycle tab, not here.
- **Pagination for very-large lists**: ship without; revisit if real buckets have thousands of abandoned uploads.
- **Filter / search by key prefix**: not in v1. Sort by age is enough.
- **Cross-bucket "purge across all buckets in connection" mega-button**: tempting but dangerous and out of scope.
