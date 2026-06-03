# File notes — workspace-shared annotations on files and folders

**Date:** 2026-06-03
**Scope:** New `FileNote` Prisma model, one new helper module, four new API routes, cascade wiring in 4 existing mutating routes, one new query module, refactor of the activity drawer into a tabbed "info drawer", one new tab component, and note-count badges in the file row and tile components.

## Problem

When a workspace shares an S3 connection, there is no way to attach context to a specific file or folder. "Don't delete this — used by prod", "approved by legal on 2026-05-30", "client signed off on this cut" — these belong on the object itself, not in chat or a separate doc. S3 itself does not solve this:

- **Object user-metadata** (`x-amz-meta-*`) is capped at 2KB total per object, has no authorship, no folder support (S3 folders are virtual), no multi-note support, and requires a HEAD per file to read.
- **Object tags** have the same author/folder/multi-note limits and a 256-char value cap.
- **Sidecar files** in the bucket would clutter the bucket the user is browsing.

The only way to get authored, multi-note, folder-aware annotations is to store them in the app database, the same way the activity feed does.

## Decision

Create a dedicated `file_notes` table. Surface notes through a CRUD API and a new **Notes** tab inside the existing right-side drawer (renamed from `ActivityDrawer` to `InfoDrawer`, now hosting both Activity and Notes tabs).

Scope rules — the Notes tab reflects the focused pane's focused item:

- **Bucket root, no single row focused** → empty state ("Select a file or folder to see notes").
- **Folder focused** (via path or single-row selection) → notes attached to that folder.
- **File focused** (via path, single-row selection, or preview open) → notes attached to that file.

Visibility is open within a workspace: both `ADMIN` and `VIEWER` roles read and write notes. VIEWERs can write because notes do not mutate S3 — they are app-level metadata.

Editing and deleting a note requires being the author OR an `ADMIN` on the workspace owning the connection.

A note count badge renders on each row/tile in the file browser when an item has notes. Counts reflect notes attached to that item only, not children.

## Data model

```prisma
model FileNote {
  id              String   @id @default(uuid())

  connectionId    String
  connection      Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  authorId        String?
  author          User?    @relation("FileNoteAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  authorDisplayName String
  authorImageUrl    String?

  bucket          String
  key             String   // trailing "/" = folder
  body            String   // plain text; no length cap at DB layer

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([connectionId, bucket, key, createdAt(sort: Desc)])
  @@index([connectionId, bucket, createdAt(sort: Desc)])
  @@index([authorId])
  @@map("file_notes")
}
```

Add inverse relations on `User` (`fileNotes FileNote[] @relation("FileNoteAuthor")`) and on `Connection` (`fileNotes FileNote[]`).

**Why this shape:**

- **Denormalized author snapshot** (`authorDisplayName`, `authorImageUrl`) matches `ActivityEvent`. Historic notes keep correct attribution after a teammate leaves. `authorId` nullable + `SetNull` preserves the row.
- **`key NOT NULL`.** Files-and-folders only — no bucket-level notes in v1. Folder vs file distinguished by trailing `/`, matching how `prefix` is treated elsewhere in this app.
- **`onDelete: Cascade` from Connection.** Removing a connection takes its notes with it. Matches activity-events.
- **No `prefix` column.** Folder-scope is just `key LIKE 'prefix/%'` for counts; the note's own location is its `key`.
- **First index** powers the per-item drawer load (`WHERE connectionId, bucket, key ORDER BY createdAt DESC`).
- **Second index** is reserved for future per-bucket queries (notes-feed, search). Not strictly needed in v1 but cheap to add now.
- **`(authorId)` index** powers a future "all my notes" view.
- **No soft-delete.** Hard delete by author/admin only.
- **Plain text body.** No formatting, no markdown, no HTML. Rendered with `whitespace-pre-wrap` and React's default escaping.

## Capture and mutation layer

### New file: `src/lib/db/notes.ts`

```ts
type CreateNoteInput = {
  connectionId: string;
  authorId: string;
  authorDisplayName: string;
  authorImageUrl: string | null;
  bucket: string;
  key: string;
  body: string;
};

export async function createNote(input: CreateNoteInput): Promise<FileNote>;
export async function updateNote(
  id: string,
  userId: string,
  isAdmin: boolean,
  body: string
): Promise<FileNote | null>;
export async function deleteNote(
  id: string,
  userId: string,
  isAdmin: boolean
): Promise<boolean>;
export async function listNotesForKey(
  connectionId: string,
  bucket: string,
  key: string
): Promise<FileNote[]>;
export async function countNotesForKeys(
  connectionId: string,
  bucket: string,
  keys: string[]
): Promise<Map<string, number>>;
```

- `updateNote` and `deleteNote` return `null` / `false` if the requester is neither the author nor an admin on the workspace owning the connection. The route maps that to 403.
- `countNotesForKeys` uses `prisma.fileNote.groupBy({ by: ["key"], where: { connectionId, bucket, key: { in: keys } }, _count: { _all: true } })` and returns a `Map<key, count>`. One round-trip per page of objects.
- `authorDisplayName` and `authorImageUrl` are snapshotted at create time and **never refreshed** — same rule as activity events. Edits do not refresh them either (the author hasn't changed).

### Cascade on object operations

Each cascade runs unconditionally on success, after the S3 operation but before the response is returned. Any exception is swallowed and `console.error`'d — failing a successful S3 op because we couldn't update an annotation is not acceptable.

| Existing route | Cascade |
|---|---|
| `POST /api/objects/rename` | `UPDATE file_notes SET key = newKey WHERE connectionId, bucket, key = oldKey`. At most one row. |
| `POST /api/objects/move` | For each `{oldKey, newKey}` in `results.filter(r => r.success)`: same update. Cross-connection move also updates `connectionId`. Batch with `Promise.all` of single-row updates (Prisma has no batched conditional update). |
| `POST /api/objects/copy` | **No-op.** Notes attach to the original; copies start fresh. Documented in the spec; revisit if users ask for note-copying. |
| `POST /api/objects/delete` | `prisma.fileNote.deleteMany({ where: { connectionId, bucket, key: { in: successKeys } } })`. |
| `DELETE /api/buckets/[bucket]` | `prisma.fileNote.deleteMany({ where: { connectionId, bucket } })`. (Connection cascade covers connection-delete; this is for the bucket-only case.) |

**Folder rename/move.** S3 folders are virtual — the existing handlers walk all child objects under the prefix and operate on each. Notes cascade rides on that: each child key being renamed gets its note row updated. If the folder itself has a note (a row where `key = "prefix/"`), that row is updated to the new prefix in the same pass.

**Folder delete.** Children's notes get deleted as their keys are deleted; the folder-self note (if any) is included in the same `deleteMany` because it shares the affected `keys` set the handler already builds.

## API

All four routes are wrapped in `withAuth` and authorize via `getConnectionAccessById(connectionId, user.id)`. VIEWERs can read and write notes (notes are app-state, not S3 mutations).

### `GET /api/notes`

List mode only. Query params: `connectionId`, `bucket`, `key` (all required).

Returns notes for the exact key, newest-first.

```ts
type FileNoteResponse = {
  id: string;
  authorId: string | null;
  authorDisplayName: string;
  authorImageUrl: string | null;
  bucket: string;
  key: string;
  body: string;
  createdAt: string;  // ISO
  updatedAt: string;  // ISO
  canEdit: boolean;   // true if requester is author OR workspace admin
};

type NotesListResponse = { notes: FileNoteResponse[] };
```

`canEdit` is computed server-side per row using the requester's id and their role on the connection's workspace (already known from `getConnectionAccessById`). The client never has to repeat the auth logic.

### `POST /api/notes/counts`

Body: `{ connectionId, bucket, keys: string[] }`. Hard cap 500 keys per request. Returns `{ counts: Record<key, number> }`. Keys absent from the response have count 0.

A `POST` (not a `GET` with comma-separated keys) avoids URL-length limits and any key-encoding issue with characters like `,`.

### `POST /api/notes`

Body: `{ connectionId, bucket, key, body }`.

- `body` is `.trim()`ed; rejected with 400 if empty after trim.
- `body` length capped at 4000 characters server-side.
- `authorDisplayName` derived from the `withAuth`-injected user: `[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email`. `authorImageUrl = user.imageUrl ?? null`.
- Returns the created `FileNoteResponse` (with `canEdit: true`).

### `PATCH /api/notes/[id]`

Body: `{ body }`. Same validation as POST.

Authorization: requester must be the author OR an admin on the workspace owning the connection. Returns 403 if not authorized, 404 if note doesn't exist. `updatedAt` bumps via Prisma `@updatedAt`. Returns the updated `FileNoteResponse`.

### `DELETE /api/notes/[id]`

Same authorization rules. Hard delete. Returns 204 on success.

### No bulk-write or import endpoints

Notes are written one at a time, by signed-in users. No server-only ingestion path exists, preventing forged authorship.

## Client query layer

### New file: `src/lib/queries/notes.ts`

```ts
useNotesForKey({ connectionId, bucket, key })
  // useQuery; returns { notes, isLoading, refetch }
  // Disabled until all three are non-empty.

useNoteCounts({ connectionId, bucket, keys })
  // useQuery; cache key = noteKeys.countsForBucket(connectionId, bucket).
  // Stale time: 1 minute.
  // Returns Record<key, number>.

useCreateNote()
useUpdateNote()
useDeleteNote()
  // All three invalidate noteKeys.forKey(connectionId, bucket, key)
  // AND noteKeys.countsForBucket(connectionId, bucket).
```

### Key factory in `src/lib/queries/keys.ts`

Following the existing factory pattern:

```ts
export const noteKeys = {
  all: ["notes"] as const,

  // Per-key list (drawer body)
  forKey: (connectionId: string, bucket: string, key: string) =>
    [...noteKeys.all, "key", connectionId, bucket, key] as const,

  // Per-page counts. Sorted keys are part of the cache key so each page
  // is its own cache entry; navigating back to a prior page is a cache hit.
  counts: (connectionId: string, bucket: string, sortedKeys: string[]) =>
    [...noteKeys.all, "counts", connectionId, bucket, sortedKeys] as const,

  // Broad invalidation target — clears every list and every counts entry
  // for the bucket in one shot. Used by mutations.
  countsForBucket: (connectionId: string, bucket: string) =>
    [...noteKeys.all, "counts", connectionId, bucket] as const,
};
```

**Two caching keys, one invalidation target.**

- Reads use `noteKeys.counts(c, b, sortedKeys)` — precise, page-stable. Each unique `keys[]` is one cache entry.
- Mutations invalidate via `queryKey: noteKeys.countsForBucket(c, b)` which is a *prefix* of every counts entry for that bucket. React Query's prefix-match invalidation handles this — every per-page counts entry for the bucket is marked stale in one call.
- `noteKeys.all` invalidates everything (lists + counts across all buckets/connections) — used by the broader object-mutation invalidation (rename/move/delete).

`useNoteCounts` sorts the incoming `keys[]` before building the cache key so input ordering doesn't fragment the cache.

### Invalidation wiring in `src/lib/queries/objects.ts`

Add `qc.invalidateQueries({ queryKey: noteKeys.all })` to the `onSuccess` of:

- `useRenameObject`
- `useMoveObjects`
- `useDeleteObjects`

(Not `useUploadObject`, `useCopyObjects`, `useCreateFolder`, `useTagObject` — none of those change existing note rows.)

## UI: Info drawer (refactor of Activity drawer)

### Rename and restructure

| Before | After |
|---|---|
| `src/lib/stores/activity-drawer-store.ts` | `src/lib/stores/info-drawer-store.ts` |
| `src/components/activity/activity-drawer.tsx` | `src/components/info-drawer/info-drawer.tsx` |
| (existing activity-body inline in drawer) | `src/components/info-drawer/activity-tab.tsx` (extracted, behavior identical) |
| — | `src/components/info-drawer/notes-tab.tsx` (new) |

### Store shape

```ts
type InfoDrawerTab = "activity" | "notes";

useInfoDrawerStore = {
  isOpen: boolean;
  activeTab: InfoDrawerTab;
  scope: {
    connectionId: string;
    bucket: string;
    prefix?: string;
    objectKey?: string;
  } | null;

  // activity-specific filter state (unchanged from current store)
  userFilter: string | null;
  actionFilter: ActivityAction[];

  // actions
  open(tab?: InfoDrawerTab): void;          // defaults to last-used activeTab
  close(): void;
  setActiveTab(tab: InfoDrawerTab): void;
  setScope(scope): void;
  setUserFilter(v): void;
  setActionFilter(v): void;
};
```

`activeTab` persists across opens — if you closed it on "Notes", it reopens on "Notes". Notes-tab has no separate persistent filter state in v1 (sort is fixed newest-first; no user/action filters).

### Component structure

```
InfoDrawer (chrome: header, tab strip, body slot, close)
├── ActivityTab    (existing activity body, extracted with no behavior change)
└── NotesTab       (new)
```

Header keeps the existing scope subtitle (`media-prod / processed/2024/Q4/` or just the key for file scope). Below the header, a two-tab strip:

```
[ Activity ] [ Notes ]
─────────────────────
```

Active tab is underlined.

**Mount point** stays at `src/app/(dashboard)/layout.tsx` — one global instance. **Width** stays 380px. **Slide animation** unchanged.

### Triggers in the file browser header

Replace the single activity button with two adjacent buttons:

```
[Activity icon] [Notes icon]   …other header buttons
```

- Activity icon opens the drawer to the Activity tab. If open on Notes, switches to Activity. If open on Activity, closes.
- Notes icon mirrors that for the Notes tab.
- Notes icon shows a small dot/indicator when the focused item has notes (cheap — reads the count for the focused key from the page's `useNoteCounts` cache).

### Scope rules

The Notes tab interprets the focused pane's state in priority order:

1. **File preview open** → scope `{ connectionId, bucket, objectKey }`. Load notes where `key = objectKey`.
2. **Exactly one row selected** in the pane → scope `{ connectionId, bucket, objectKey: selectedKey }`. The selected row may be a file (no trailing `/`) or a folder (trailing `/`). Either way, load notes where `key = selectedKey`.
3. **Current path is a folder, no row selected** → scope `{ connectionId, bucket, prefix }`. Load notes where `key = prefix` (the folder-self note for the folder the user is currently inside).
4. **Bucket root, no row selected** → empty state, "Select a file or folder to see notes". No composer.
5. **Multiple rows selected** → empty state, "Select a single file or folder to see notes". No composer.

"Focused row" maps to "exactly one item in `browser-store.paneStates[focusedPaneId].selectedItems`". The info-drawer-store subscribes to the focused pane's selection set and recomputes scope on change. Multi-select clears focus.

## UI: Notes tab

### Layout

```
┌─ scope subtitle: foo.txt ──────────────────┐
│                                            │
│  [avatar] Alice                  2m ago    │
│           Don't delete — used by prod.     │
│           [⋯ menu: Edit, Delete]           │
│  ──────────────────────────────────────    │
│  [avatar] Bob                   1h ago     │
│           Approved by legal 2026-05-30.    │
│  ──────────────────────────────────────    │
│                                            │
│  [textarea: add a note...]                 │
│  [Cancel]              [Add note]          │
└────────────────────────────────────────────┘
```

### Row anatomy

- 24px avatar — image or initials-circle. Reuses the avatar helper currently inside `activity-drawer.tsx`; extracted to a shared util (`src/components/info-drawer/avatar.tsx`) during the refactor since both tabs use it.
- Author display name, relative timestamp on the right (`2m ago`, `Mar 21`). Reuses `formatRelativeTime` — extracted to a shared util during the refactor.
- Body rendered with `whitespace-pre-wrap` for preserved newlines.
- `⋯` menu appears only when `note.canEdit` is true. Menu items: **Edit**, **Delete**.
- If `updatedAt > createdAt + 60s`, append a muted `(edited)` next to the timestamp.

### Edit mode (inline)

The body becomes a `<textarea>` prefilled with the current body; **Save** and **Cancel** buttons replace the row menu. `Ctrl/Cmd+Enter` saves; `Esc` cancels. Optimistic update — React Query swaps the body optimistically and rolls back on error.

### Delete

Inline confirmation: "Delete this note?" with **Yes** / **Cancel** in place of the menu. Optimistic remove on confirm.

### Composer (always at the bottom of the list, or center if empty)

- Single `<textarea>` autosizing 3 → 8 rows.
- Submit on `Ctrl/Cmd+Enter`. Plain `Enter` inserts a newline.
- Disabled / hidden when scope is bucket-root (nowhere to attach).
- Soft character counter appears at 3500+; submit disabled past 4000 (server cap).

### Empty / loading / error states

- **Loading first page:** centered spinner.
- **Loaded, no notes:** centered "No notes yet" with the composer below.
- **Error:** "Couldn't load notes" + Retry button.
- **Bucket-root scope:** "Select a file or folder to see notes". No composer.
- **Mutation errors:** existing `use-toast` for failures.

### Sort

Fixed newest-first. No filter UI in v1.

### Scope changes during use

When the user focuses a different file, the drawer body cross-fades to the new list. The composer's typed-but-unsubmitted draft is **discarded** on scope change. Acceptable risk for v1 — notes are typically short. If users hit this, the fix is a `{ [key]: draft }` map in the store.

## UI: list indicators (badges)

### Where badges appear

| Surface | Indicator |
|---|---|
| `FileRow` (table view) | `MessageSquare` icon + count, small, muted color, between name and size columns. Hidden when count is 0. |
| `FileTile` (gallery view) | Same icon + count overlaid top-right of the tile. |
| Folder rows / tiles | Same as files. Reflects folder-self notes only — children's notes do not roll up (matches scope rule). |
| Sidebar lists, bookmarks, command palette | Out of scope for v1. |

Icon style: `MessageSquare` filled when count > 0, ~14px.

### Data source

Each `BucketPage`-style component fetches its `objects[]` then issues one `useNoteCounts({ connectionId, bucket, keys: objects.map(o => o.key) })` query per page. The hook returns `Record<key, number>`; each row component reads its own count.

`S3Object.key` already includes trailing `/` for folders, matching how notes are keyed. No transformation needed at the row layer.

### Refresh

- Note mutations invalidate `noteKeys.countsForBucket(connectionId, bucket)` → badges refresh on the current page.
- Object rename/move/delete invalidate `noteKeys.all` (per the cascade-invalidation wiring) → badges reflect the move/delete.
- No real-time push. 1-minute stale time across all queries (matches the rest of the app).

### Click behavior

Clicking the badge focuses the row (same as clicking the row itself) **and** opens the drawer on the Notes tab. If the drawer is already open on Activity, badge click switches it to Notes.

## Edge cases

| Scenario | Behavior |
|---|---|
| Drawer open on a file, teammate deletes the file via another session | Existing `objects.delete` mutation invalidates `objectKeys.all`; the cascade also deletes the notes server-side. Next refetch returns 0 notes; drawer shows "No notes yet". Scope itself stays valid until the user navigates. |
| Drawer open on a file, teammate renames it via another session | Notes follow the rename (cascade). The open drawer is still pointed at the OLD key — refetches return empty. Refresh / re-focus on the new key shows the notes there. Same staleness window as the activity drawer. |
| Author leaves the workspace | `authorId` → null via `SetNull`. Snapshot fields keep correct display. `canEdit` becomes false for everyone except workspace admins. |
| Two users edit the same note simultaneously | Last write wins (PATCH replaces `body`). No optimistic concurrency token in v1. Notes are short; real contention is rare. |
| User pastes a 10MB string into the composer | Client soft-shows counter at 3500; submit disabled past 4000. Server rejects with 400 if bypassed. |
| Notes contain URLs or HTML-looking text | Plain text. Rendered with `whitespace-pre-wrap` and React's default escaping. No linkification. |
| Folder rename moves N children, each with notes | Cascade does up to N+1 single-row updates (children + folder-self if any). Wrapped in a Prisma transaction inside the rename route. Transaction failure → all-or-nothing; the rename's S3 work has already succeeded, so we accept the orphan-notes risk and log it. No automatic retry. |
| Connection deleted while drawer open | `getConnectionAccessById` returns null → 404 → drawer shows error state. Cascade-on-Connection-delete cleans up notes. |
| Cross-connection move | Note's `connectionId` and `key` update to the target. If the requester doesn't have access to the target connection, the move itself fails before the cascade runs. |
| Bulk delete of 1000 files | DELETE handler runs one `deleteMany` with `key: { in: keys }`. No N+1. |
| Object key contains `,` | Count mode uses `POST` with a JSON body; keys are not URL-parsed. Safe. |
| Note longer than 4000 chars exists (created under an older policy) | Display unchanged. Edit form respects the new 4000 cap; the user must trim before saving. |
| `prisma migrate` fails mid-run | Migration is purely additive (one new table, three indexes). Safe to retry or roll back. |
| `VIEWER` role on the connection | Reads notes. Writes notes. Edits / deletes only their own. Cannot delete others' notes (admin-only). |
| `ADMIN` role on the connection | Reads, writes, edits any, deletes any. |
| Drawer open on Activity tab, badge clicked on a row | Drawer switches to Notes tab and updates scope to the clicked row. No animation glitch — tab change is instantaneous. |

## Out of scope (v1)

Captured here so the next person extending the feature does not have to re-derive what was considered and deferred:

- **Bucket-level notes.** Decided against in scoping. The drawer's Notes tab shows an empty state at bucket-root. Adding later: relax `key NOT NULL`, treat `null` as "bucket scope", add a "bucket info" entry in the header dropdown.
- **Recursive folder scope** ("show all notes under this folder"). Adds digest-style value but creates noisy lists. Out of v1; a future toggle in the Notes tab header.
- **Threading / replies / reactions.** Notes are flat, single-body, single-author. The data model has no parent-reference column. Adding later means a self-relation + UI rework.
- **Markdown or rich text.** Plain text only. Adding markdown later means a renderer + sanitization layer.
- **`@mentions` / linkified URLs.** No parsing of the body. Adding later only needs a parse + render layer; the data stays plain text.
- **Notifications** (email / Slack / in-app) when someone notes your file. Different surface — channels, per-user preferences, digest scheduling.
- **Soft-delete with restore.** Notes are hard-deleted by the author or admins. Adding later needs a `deletedAt` column.
- **Optimistic-concurrency tokens** for simultaneous edits. v1 is last-write-wins.
- **Per-user draft persistence** across scope changes. v1 discards the unsubmitted draft when scope changes.
- **Notes-on-copy.** Copy operation does not duplicate notes. Future: an opt-in `copyNotes: true` flag on the copy route.
- **"All my notes" view.** The `(authorId)` index supports it; no UI in v1.
- **Bucket-wide notes feed** ("recent notes across this bucket"). The second composite index supports it; no UI in v1.
- **Search inside note bodies.** Postgres FTS or trigram index, future work.
- **Notes export.** A `GET /api/notes/export` reading the same data, future.
- **Sidebar / bookmarks / command-palette badges.** Only file-list rows and tiles get badges in v1.
- **Counts roll-up to folders.** Folder badge reflects folder-self notes only. Future: a separate `recursiveCount` field.
- **Live updates** (polling / SSE). 1-minute stale time + invalidation on mutations, like activity feed and the rest of the app.
- **Tier-based caps** on note count or length. Same posture as activity — subscription model is in place to add later.

## Implementation order

Each step is independently testable; user-visible UI starts at step 9.

1. Prisma schema — `FileNote` model + three indexes + inverse relations on `User` and `Connection`. `prisma migrate dev --name add-file-notes`.
2. `src/lib/db/notes.ts` — `createNote`, `updateNote`, `deleteNote`, `listNotesForKey`, `countNotesForKeys`. Author/admin authorization lives here.
3. Wire cascade in `POST /api/objects/rename` (single-row update, inside the existing transaction or alongside it).
4. Wire cascade in `POST /api/objects/move` and `POST /api/objects/delete` (batch, filtered to successful results only).
5. Wire cascade in `DELETE /api/buckets/[bucket]` (batch delete by `connectionId, bucket`).
6. `GET /api/notes` (list for one key) + `POST /api/notes` + `PATCH /api/notes/[id]` + `DELETE /api/notes/[id]`, all with `withAuth` + `getConnectionAccessById`. Returns `canEdit` per row.
7. `POST /api/notes/counts` — body `{ connectionId, bucket, keys[] }` → `{ counts: Record<key, number> }`. Hard cap 500 keys.
8. `src/lib/queries/notes.ts` + `noteKeys` in `keys.ts`. Add `noteKeys.all` invalidation to the existing rename/move/delete mutation hooks in `src/lib/queries/objects.ts`.
9. **Refactor:** rename `activity-drawer-store.ts` → `info-drawer-store.ts`, add `activeTab` + `setActiveTab`. Update the existing trigger button in the file browser header to use the renamed store.
10. **Refactor:** extract activity drawer body into `ActivityTab.tsx`; rename `activity-drawer.tsx` → `info-drawer.tsx`; add tab strip and body slot dispatching on `activeTab`. Extract shared `Avatar` and `formatRelativeTime` to `src/components/info-drawer/`. Acceptance: existing activity behavior, layout, and filter state are pixel-identical to pre-refactor.
11. `NotesTab.tsx` — list + composer + inline edit / delete UI. Empty/loading/error states.
12. File browser header — replace the single activity button with `[ActivityButton][NotesButton]` pair, both bound to `useInfoDrawerStore`. Wire single-click-row focus through `browser-store` → drawer scope.
13. `FileRow` and `FileTile` — note count badge using `useNoteCounts` for the page. Badge click → focus + open Notes tab.
