# Bulk Operations Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom-centered floating panel that appears when 2+ objects are selected in the file browser, offering bulk Rename (pattern transform), Tag (replace), and Delete with per-item progress feedback.

**Architecture:** A `BulkOpsPanel` mounts inside `FileBrowser` and reads the pane's `selectedItems` set from the existing Zustand `browser-store`. It renders three modes: idle (action buttons), dialog-open (rename/tag form or delete confirm), and running (progress bar). A new `bulk-ops-store` tracks just the in-progress operation state (current op, items processed, current item, failures). Single-item server endpoints (`/api/objects/rename`, `/api/objects/tag`) are added so the client can iterate the selection and update progress as each item completes. Rename pattern logic lives in a pure module (`src/lib/bulk-rename.ts`) for clarity and live-preview reuse. The existing toolbar "Delete (N)" button is removed — the panel becomes the single entry point for bulk actions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zustand, TanStack React Query, Radix UI primitives (Dialog, Progress), Tailwind CSS 4, AWS SDK v3 (`@aws-sdk/client-s3`: `CopyObjectCommand`, `DeleteObjectCommand`, `PutObjectTaggingCommand`).

---

## File Structure

**Create:**
- `src/lib/bulk-rename.ts` — pure rename-pattern logic (Find/Replace, Prefix, Suffix, Sequence). No React.
- `src/lib/stores/bulk-ops-store.ts` — Zustand store tracking the active bulk operation's progress.
- `src/lib/queries/objects-bulk.ts` — single-item React Query mutations: rename, tag, delete one.
- `src/app/api/objects/rename/route.ts` — server: copy + delete-source for one key.
- `src/app/api/objects/tag/route.ts` — server: PutObjectTagging for one key.
- `src/components/browser/bulk-ops-panel.tsx` — the bottom-centered floating panel, controls the three modes.
- `src/components/browser/bulk-rename-dialog.tsx` — pattern picker + live preview list.
- `src/components/browser/bulk-tag-dialog.tsx` — key/value tag rows editor.

**Modify:**
- `src/components/browser/file-browser.tsx` — remove the toolbar "Delete (N)" button and mount `BulkOpsPanel`.

---

### Task 1: Pure rename-pattern logic

**Files:**
- Create: `src/lib/bulk-rename.ts`

The rename panel transforms each selected key into a new key by applying one of four patterns to the *file name only* (the part after the last `/`, before the extension for files). Folders end with `/`; their name is the last non-empty segment. This module is pure and exports a single `applyRenamePattern` function plus the `RenamePattern` discriminated union.

- [ ] **Step 1: Write the module**

```ts
export type RenamePattern =
  | { kind: "find-replace"; find: string; replace: string; matchCase: boolean }
  | { kind: "prefix"; text: string }
  | { kind: "suffix"; text: string }
  | { kind: "sequence"; baseName: string; startAt: number; padTo: number };

export interface RenamePreviewItem {
  oldKey: string;
  newKey: string;
  changed: boolean;
}

function splitNameExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function transformName(name: string, isFolder: boolean, pattern: RenamePattern, index: number): string {
  if (isFolder) {
    switch (pattern.kind) {
      case "find-replace": {
        const flags = pattern.matchCase ? "g" : "gi";
        const re = new RegExp(pattern.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        return pattern.find ? name.replace(re, pattern.replace) : name;
      }
      case "prefix":
        return pattern.text + name;
      case "suffix":
        return name + pattern.text;
      case "sequence": {
        const n = String(pattern.startAt + index).padStart(pattern.padTo, "0");
        return `${pattern.baseName}${n}`;
      }
    }
  }
  const { stem, ext } = splitNameExt(name);
  switch (pattern.kind) {
    case "find-replace": {
      if (!pattern.find) return stem + ext;
      const flags = pattern.matchCase ? "g" : "gi";
      const re = new RegExp(pattern.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      return stem.replace(re, pattern.replace) + ext;
    }
    case "prefix":
      return pattern.text + stem + ext;
    case "suffix":
      return stem + pattern.text + ext;
    case "sequence": {
      const n = String(pattern.startAt + index).padStart(pattern.padTo, "0");
      return `${pattern.baseName}${n}${ext}`;
    }
  }
}

export function applyRenamePattern(
  keys: string[],
  pattern: RenamePattern
): RenamePreviewItem[] {
  return keys.map((oldKey, index) => {
    const isFolder = oldKey.endsWith("/");
    const trimmed = isFolder ? oldKey.slice(0, -1) : oldKey;
    const lastSlash = trimmed.lastIndexOf("/");
    const parent = lastSlash === -1 ? "" : trimmed.slice(0, lastSlash + 1);
    const name = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
    const newName = transformName(name, isFolder, pattern, index);
    const newKey = parent + newName + (isFolder ? "/" : "");
    return { oldKey, newKey, changed: oldKey !== newKey };
  });
}
```

- [ ] **Step 2: Manually verify by adding a temporary scratch import in `src/app/page.tsx`** (delete after sanity-check)

Open `src/app/page.tsx`, add at top temporarily:

```ts
import { applyRenamePattern } from "@/lib/bulk-rename";
console.log(applyRenamePattern(
  ["photos/a.jpg", "photos/b.jpg", "photos/sub/"],
  { kind: "prefix", text: "new-" }
));
```

Run `pnpm dev`, load the root page, check browser devtools console for:
```
[
  { oldKey: "photos/a.jpg", newKey: "photos/new-a.jpg", changed: true },
  { oldKey: "photos/b.jpg", newKey: "photos/new-b.jpg", changed: true },
  { oldKey: "photos/sub/", newKey: "photos/new-sub/", changed: true }
]
```

Then revert the temporary import — leave the file otherwise untouched.

- [ ] **Step 3: Commit**

```bash
git add src/lib/bulk-rename.ts
git commit -m "feat: add pure rename pattern transform module"
```

---

### Task 2: Bulk operations Zustand store

**Files:**
- Create: `src/lib/stores/bulk-ops-store.ts`

Tracks the *active* bulk operation only. Selection itself stays in `browser-store`. This store powers the in-panel progress UI and the dialog-open state.

- [ ] **Step 1: Write the module**

```ts
import { create } from "zustand";

export type BulkOpKind = "rename" | "tag" | "delete";
export type BulkOpDialog = "rename" | "tag" | "delete" | null;

export interface BulkOpFailure {
  key: string;
  error: string;
}

export interface BulkOpProgress {
  kind: BulkOpKind;
  paneId: string;
  total: number;
  completed: number;
  currentKey: string | null;
  failures: BulkOpFailure[];
  cancelRequested: boolean;
  finishedAt: Date | null;
}

interface BulkOpsState {
  dialog: BulkOpDialog;
  dialogPaneId: string | null;
  progress: BulkOpProgress | null;

  openDialog: (kind: BulkOpDialog, paneId: string) => void;
  closeDialog: () => void;

  startProgress: (kind: BulkOpKind, paneId: string, total: number) => void;
  setCurrentKey: (key: string | null) => void;
  recordSuccess: () => void;
  recordFailure: (failure: BulkOpFailure) => void;
  requestCancel: () => void;
  finishProgress: () => void;
  dismissProgress: () => void;
}

export const useBulkOpsStore = create<BulkOpsState>((set) => ({
  dialog: null,
  dialogPaneId: null,
  progress: null,

  openDialog: (kind, paneId) => set({ dialog: kind, dialogPaneId: paneId }),
  closeDialog: () => set({ dialog: null, dialogPaneId: null }),

  startProgress: (kind, paneId, total) =>
    set({
      dialog: null,
      dialogPaneId: null,
      progress: {
        kind,
        paneId,
        total,
        completed: 0,
        currentKey: null,
        failures: [],
        cancelRequested: false,
        finishedAt: null,
      },
    }),
  setCurrentKey: (key) =>
    set((state) =>
      state.progress ? { progress: { ...state.progress, currentKey: key } } : state
    ),
  recordSuccess: () =>
    set((state) =>
      state.progress
        ? { progress: { ...state.progress, completed: state.progress.completed + 1 } }
        : state
    ),
  recordFailure: (failure) =>
    set((state) =>
      state.progress
        ? {
            progress: {
              ...state.progress,
              completed: state.progress.completed + 1,
              failures: [...state.progress.failures, failure],
            },
          }
        : state
    ),
  requestCancel: () =>
    set((state) =>
      state.progress ? { progress: { ...state.progress, cancelRequested: true } } : state
    ),
  finishProgress: () =>
    set((state) =>
      state.progress
        ? { progress: { ...state.progress, currentKey: null, finishedAt: new Date() } }
        : state
    ),
  dismissProgress: () => set({ progress: null }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/stores/bulk-ops-store.ts
git commit -m "feat: add bulk-ops store for dialog and progress state"
```

---

### Task 3: Server endpoint — single-object rename

**Files:**
- Create: `src/app/api/objects/rename/route.ts`

Renames one key by copying to the new key and deleting the source. Follows the exact pattern of `src/app/api/objects/copy/route.ts:55-77` for auth and `getConnectionAccessById`. For this iteration, **rename only supports files, not folders** — folder rename would require listing & rewriting every descendant. The client filters folders out before calling.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@/lib/s3/client";
import { getConnectionAccessById } from "@/lib/db/connections";
import { withAuth } from "@/lib/auth";

interface RenameRequest {
  connectionId: string;
  bucket: string;
  sourceKey: string;
  targetKey: string;
}

export const POST = withAuth(async (req, { user }) => {
  try {
    const { connectionId, bucket, sourceKey, targetKey }: RenameRequest =
      await req.json();

    if (!connectionId || !bucket || !sourceKey || !targetKey) {
      return NextResponse.json(
        { error: "connectionId, bucket, sourceKey, and targetKey are required" },
        { status: 400 }
      );
    }

    if (sourceKey === targetKey) {
      return NextResponse.json({ success: true, skipped: true });
    }

    if (sourceKey.endsWith("/")) {
      return NextResponse.json(
        { error: "Folder rename is not supported in bulk operations" },
        { status: 400 }
      );
    }

    const access = await getConnectionAccessById(connectionId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (access.role !== "ADMIN") {
      return NextResponse.json(
        { error: "You do not have permission to modify objects for this connection" },
        { status: 403 }
      );
    }

    const client = createS3Client(access.connection);

    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: targetKey,
        CopySource: encodeURIComponent(`${bucket}/${sourceKey}`),
      })
    );
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey })
    );

    return NextResponse.json({ success: true, targetKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
```

- [ ] **Step 2: Verify manually**

Start dev server (if not already): `pnpm dev`. Open a browser tab with devtools, then run from the console while logged in:

```js
fetch("/api/objects/rename", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    connectionId: "<a-connection-id-from-your-db>",
    bucket: "<a-bucket-name>",
    sourceKey: "<an-existing-key>",
    targetKey: "<new-name>",
  }),
}).then((r) => r.json()).then(console.log);
```

Expected: `{ success: true, targetKey: "<new-name>" }`, and refreshing the browser shows the file renamed.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/objects/rename/route.ts
git commit -m "feat: add single-object rename API route"
```

---

### Task 4: Server endpoint — single-object tag (replace)

**Files:**
- Create: `src/app/api/objects/tag/route.ts`

Replaces the entire tag set on one object. S3's `PutObjectTagging` is a full replacement (not a merge) — this matches the chosen "Replace tags on all selected" UX. Folder tagging is not meaningful for S3 (folders are virtual / a folder key like `foo/` is an empty zero-byte object — applying tags to it works but tags don't propagate to children). The client filters folders out.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { PutObjectTaggingCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@/lib/s3/client";
import { getConnectionAccessById } from "@/lib/db/connections";
import { withAuth } from "@/lib/auth";

interface TagRequest {
  connectionId: string;
  bucket: string;
  key: string;
  tags: Array<{ key: string; value: string }>;
}

export const POST = withAuth(async (req, { user }) => {
  try {
    const { connectionId, bucket, key, tags }: TagRequest = await req.json();

    if (!connectionId || !bucket || !key || !Array.isArray(tags)) {
      return NextResponse.json(
        { error: "connectionId, bucket, key, and tags are required" },
        { status: 400 }
      );
    }

    if (key.endsWith("/")) {
      return NextResponse.json(
        { error: "Folder tagging is not supported in bulk operations" },
        { status: 400 }
      );
    }

    const access = await getConnectionAccessById(connectionId, user.id);
    if (!access) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (access.role !== "ADMIN") {
      return NextResponse.json(
        { error: "You do not have permission to modify objects for this connection" },
        { status: 403 }
      );
    }

    const client = createS3Client(access.connection);
    await client.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: { TagSet: tags.map((t) => ({ Key: t.key, Value: t.value })) },
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
```

- [ ] **Step 2: Verify manually**

In devtools console, with a real existing file key:

```js
fetch("/api/objects/tag", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    connectionId: "<a-connection-id>",
    bucket: "<a-bucket>",
    key: "<an-existing-file-key>",
    tags: [{ key: "env", value: "prod" }, { key: "owner", value: "me" }],
  }),
}).then((r) => r.json()).then(console.log);
```

Expected: `{ success: true }`. Verify with the AWS CLI or MinIO console that the object now has those two tags as its full tag set.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/objects/tag/route.ts
git commit -m "feat: add single-object tag-replace API route"
```

---

### Task 5: Client mutations for the three single-item operations

**Files:**
- Create: `src/lib/queries/objects-bulk.ts`

Single-item mutations the panel will call in a loop. Each invalidates the objects query on success so the browser refreshes once the loop finishes. We do **not** use `useMutation` here because the panel needs to await each call sequentially and update progress between calls — we expose raw async functions instead.

- [ ] **Step 1: Write the module**

```ts
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

export interface RenameArgs {
  connectionId: string;
  bucket: string;
  sourceKey: string;
  targetKey: string;
}

export interface TagArgs {
  connectionId: string;
  bucket: string;
  key: string;
  tags: Array<{ key: string; value: string }>;
}

export interface DeleteOneArgs {
  connectionId: string;
  bucket: string;
  key: string;
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
}

export async function renameObject(args: RenameArgs): Promise<void> {
  await postJson("/api/objects/rename", args);
}

export async function setObjectTags(args: TagArgs): Promise<void> {
  await postJson("/api/objects/tag", args);
}

export async function deleteOneObject(args: DeleteOneArgs): Promise<void> {
  await postJson("/api/objects/delete", {
    connectionId: args.connectionId,
    bucket: args.bucket,
    keys: [args.key],
  });
}

export function useInvalidateObjects() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.objects.all });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/queries/objects-bulk.ts
git commit -m "feat: add single-item bulk-op client helpers"
```

---

### Task 6: Bulk rename dialog (pattern picker + live preview)

**Files:**
- Create: `src/components/browser/bulk-rename-dialog.tsx`

Dialog opened from the panel. User picks one of four pattern kinds, fills in inputs, sees a live preview of `oldKey → newKey` for every selected file. "Apply" calls back into the panel with the resolved `RenamePreviewItem[]`. Folders in the selection are excluded from the preview list with a small note.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyRenamePattern,
  type RenamePattern,
  type RenamePreviewItem,
} from "@/lib/bulk-rename";
import type { S3Object } from "@/types";

interface BulkRenameDialogProps {
  open: boolean;
  onClose: () => void;
  selection: S3Object[];
  onApply: (items: RenamePreviewItem[]) => void;
}

type PatternKind = RenamePattern["kind"];

export function BulkRenameDialog({
  open,
  onClose,
  selection,
  onApply,
}: BulkRenameDialogProps) {
  const [kind, setKind] = useState<PatternKind>("find-replace");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [baseName, setBaseName] = useState("file-");
  const [startAt, setStartAt] = useState(1);
  const [padTo, setPadTo] = useState(3);

  const fileSelection = useMemo(
    () => selection.filter((o) => !o.isFolder),
    [selection]
  );
  const folderCount = selection.length - fileSelection.length;

  const pattern: RenamePattern = useMemo(() => {
    switch (kind) {
      case "find-replace":
        return { kind: "find-replace", find, replace, matchCase };
      case "prefix":
        return { kind: "prefix", text: prefix };
      case "suffix":
        return { kind: "suffix", text: suffix };
      case "sequence":
        return { kind: "sequence", baseName, startAt, padTo };
    }
  }, [kind, find, replace, matchCase, prefix, suffix, baseName, startAt, padTo]);

  const preview = useMemo(
    () => applyRenamePattern(fileSelection.map((o) => o.key), pattern),
    [fileSelection, pattern]
  );

  const changedCount = preview.filter((p) => p.changed).length;
  const hasDuplicates = useMemo(() => {
    const seen = new Set<string>();
    for (const p of preview) {
      if (seen.has(p.newKey)) return true;
      seen.add(p.newKey);
    }
    return false;
  }, [preview]);

  const canApply = changedCount > 0 && !hasDuplicates;

  const handleApply = () => {
    onApply(preview.filter((p) => p.changed));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rename {fileSelection.length} item{fileSelection.length !== 1 ? "s" : ""}</DialogTitle>
          <DialogDescription>
            Apply a pattern transform. Folders cannot be bulk-renamed and are skipped.
            {folderCount > 0 && ` (${folderCount} folder${folderCount !== 1 ? "s" : ""} excluded)`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            {(["find-replace", "prefix", "suffix", "sequence"] as PatternKind[]).map((k) => (
              <Button
                key={k}
                type="button"
                variant={kind === k ? "default" : "outline"}
                size="sm"
                onClick={() => setKind(k)}
              >
                {k === "find-replace" ? "Find / Replace" : k.charAt(0).toUpperCase() + k.slice(1)}
              </Button>
            ))}
          </div>

          {kind === "find-replace" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="find">Find</Label>
                <Input id="find" value={find} onChange={(e) => setFind(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="replace">Replace with</Label>
                <Input id="replace" value={replace} onChange={(e) => setReplace(e.target.value)} />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={matchCase}
                  onChange={(e) => setMatchCase(e.target.checked)}
                />
                Match case
              </label>
            </div>
          )}

          {kind === "prefix" && (
            <div>
              <Label htmlFor="prefix">Prefix</Label>
              <Input id="prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </div>
          )}

          {kind === "suffix" && (
            <div>
              <Label htmlFor="suffix">Suffix (before extension)</Label>
              <Input id="suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
            </div>
          )}

          {kind === "sequence" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <Label htmlFor="base">Base name</Label>
                <Input id="base" value={baseName} onChange={(e) => setBaseName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="start">Start at</Label>
                <Input
                  id="start"
                  type="number"
                  value={startAt}
                  onChange={(e) => setStartAt(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label htmlFor="pad">Pad to</Label>
                <Input
                  id="pad"
                  type="number"
                  min={0}
                  value={padTo}
                  onChange={(e) => setPadTo(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
            </div>
          )}

          <div className="border rounded-md max-h-64 overflow-y-auto text-xs font-mono">
            {preview.length === 0 ? (
              <div className="p-3 text-muted-foreground">No files selected.</div>
            ) : (
              preview.map((p) => (
                <div
                  key={p.oldKey}
                  className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 ${
                    p.changed ? "" : "text-muted-foreground"
                  }`}
                >
                  <span className="truncate flex-1" title={p.oldKey}>{p.oldKey}</span>
                  <span>→</span>
                  <span className="truncate flex-1" title={p.newKey}>{p.newKey}</span>
                </div>
              ))
            )}
          </div>

          {hasDuplicates && (
            <p className="text-sm text-destructive">
              Pattern produces duplicate names. Adjust before applying.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={!canApply}>
            Rename {changedCount} item{changedCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/browser/bulk-rename-dialog.tsx
git commit -m "feat: add bulk rename dialog with pattern preview"
```

---

### Task 7: Bulk tag dialog (key/value rows)

**Files:**
- Create: `src/components/browser/bulk-tag-dialog.tsx`

Editable list of key/value rows. On apply, the same `tags` array is written to every selected (non-folder) object via PutObjectTagging — replacing whatever tags those objects had.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import type { S3Object } from "@/types";

interface TagRow {
  id: string;
  key: string;
  value: string;
}

interface BulkTagDialogProps {
  open: boolean;
  onClose: () => void;
  selection: S3Object[];
  onApply: (tags: Array<{ key: string; value: string }>) => void;
}

function rowId(): string {
  return `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function BulkTagDialog({ open, onClose, selection, onApply }: BulkTagDialogProps) {
  const [rows, setRows] = useState<TagRow[]>([{ id: rowId(), key: "", value: "" }]);

  const fileSelection = useMemo(() => selection.filter((o) => !o.isFolder), [selection]);
  const folderCount = selection.length - fileSelection.length;

  const validTags = useMemo(
    () =>
      rows
        .map((r) => ({ key: r.key.trim(), value: r.value.trim() }))
        .filter((t) => t.key.length > 0),
    [rows]
  );

  const duplicateKeys = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of validTags) counts[t.key] = (counts[t.key] ?? 0) + 1;
    return Object.entries(counts).filter(([, c]) => c > 1).map(([k]) => k);
  }, [validTags]);

  const canApply = fileSelection.length > 0 && duplicateKeys.length === 0;

  const updateRow = (id: string, patch: Partial<TagRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [...rs, { id: rowId(), key: "", value: "" }]);
  const removeRow = (id: string) =>
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((r) => r.id !== id)));

  const handleApply = () => onApply(validTags);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set tags on {fileSelection.length} item{fileSelection.length !== 1 ? "s" : ""}</DialogTitle>
          <DialogDescription>
            These tags will <strong>replace</strong> any existing tags on the selected objects.
            {folderCount > 0 && ` (${folderCount} folder${folderCount !== 1 ? "s" : ""} excluded)`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                placeholder="Key"
                value={row.key}
                onChange={(e) => updateRow(row.id, { key: e.target.value })}
              />
              <Input
                placeholder="Value"
                value={row.value}
                onChange={(e) => updateRow(row.id, { value: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(row.id)}
                disabled={rows.length === 1}
                aria-label="Remove tag"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-2 h-4 w-4" />
            Add tag
          </Button>
          {duplicateKeys.length > 0 && (
            <p className="text-sm text-destructive">
              Duplicate keys: {duplicateKeys.join(", ")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={!canApply}>
            Apply tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/browser/bulk-tag-dialog.tsx
git commit -m "feat: add bulk tag dialog (replace mode)"
```

---

### Task 8: BulkOpsPanel component (idle + running + delete confirm)

**Files:**
- Create: `src/components/browser/bulk-ops-panel.tsx`

The bottom-centered floating panel. Three visual modes driven by `bulk-ops-store`:

1. **Idle** — visible whenever `selectedItems.size >= 2` and no progress is running. Shows selection count, action buttons (Rename, Tag, Delete, Clear), and a close button.
2. **Running** — visible whenever `progress` is set. Shows progress bar (completed / total), current key, failure count, and Cancel (during) / Dismiss (after).
3. **Dialogs** — Rename / Tag dialogs (mounted here) and an inline Delete confirm step. The dialog component itself is the modal; the panel stays underneath.

The panel also owns the bulk-op runners — async loops that drive the three operations and update the store as each item completes.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useBulkOpsStore } from "@/lib/stores/bulk-ops-store";
import { useBrowserStore } from "@/lib/stores/browser-store";
import { useNotificationStore } from "@/lib/stores/notification-store";
import {
  deleteOneObject,
  renameObject,
  setObjectTags,
  useInvalidateObjects,
} from "@/lib/queries/objects-bulk";
import { BulkRenameDialog } from "./bulk-rename-dialog";
import { BulkTagDialog } from "./bulk-tag-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Tag, Trash2, X, Loader2, AlertCircle, Check } from "lucide-react";
import type { S3Object } from "@/types";
import type { RenamePreviewItem } from "@/lib/bulk-rename";

interface BulkOpsPanelProps {
  paneId: string;
  connectionId: string;
  bucket: string;
  objects: S3Object[];
  canWrite: boolean;
}

export function BulkOpsPanel({
  paneId,
  connectionId,
  bucket,
  objects,
  canWrite,
}: BulkOpsPanelProps) {
  const { getPaneState, clearSelection } = useBrowserStore();
  const selectedItems = getPaneState(paneId).selectedItems;
  const {
    dialog,
    dialogPaneId,
    progress,
    openDialog,
    closeDialog,
    startProgress,
    setCurrentKey,
    recordSuccess,
    recordFailure,
    requestCancel,
    finishProgress,
    dismissProgress,
  } = useBulkOpsStore();
  const { addNotification } = useNotificationStore();
  const invalidateObjects = useInvalidateObjects();

  const selection: S3Object[] = objects.filter((o) => selectedItems.has(o.key));
  const dialogOpen = dialog !== null && dialogPaneId === paneId;
  const showProgress = progress !== null && progress.paneId === paneId;
  const showIdle =
    canWrite && !showProgress && !dialogOpen && selectedItems.size >= 2;

  const runLoop = useCallback(
    async <T,>(
      kind: "rename" | "tag" | "delete",
      items: T[],
      keyOf: (item: T) => string,
      action: (item: T) => Promise<void>
    ) => {
      startProgress(kind, paneId, items.length);
      for (const item of items) {
        if (useBulkOpsStore.getState().progress?.cancelRequested) break;
        const key = keyOf(item);
        setCurrentKey(key);
        try {
          await action(item);
          recordSuccess();
        } catch (error) {
          recordFailure({
            key,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
      finishProgress();
      invalidateObjects();
      const finalState = useBulkOpsStore.getState().progress;
      if (finalState) {
        const ok = finalState.completed - finalState.failures.length;
        addNotification({
          type: kind === "rename" ? "info" : kind,
          title:
            finalState.failures.length === 0
              ? `${kind === "rename" ? "Renamed" : kind === "tag" ? "Tagged" : "Deleted"} ${ok} item${ok !== 1 ? "s" : ""}`
              : `${kind} finished with ${finalState.failures.length} error${finalState.failures.length !== 1 ? "s" : ""}`,
          status: finalState.failures.length === 0 ? "completed" : "error",
        });
      }
      if (finalState && finalState.failures.length === 0) {
        clearSelection(paneId);
      }
    },
    [
      paneId,
      startProgress,
      setCurrentKey,
      recordSuccess,
      recordFailure,
      finishProgress,
      invalidateObjects,
      addNotification,
      clearSelection,
    ]
  );

  const handleRenameApply = useCallback(
    async (items: RenamePreviewItem[]) => {
      closeDialog();
      await runLoop(
        "rename",
        items,
        (it) => it.oldKey,
        (it) =>
          renameObject({
            connectionId,
            bucket,
            sourceKey: it.oldKey,
            targetKey: it.newKey,
          })
      );
    },
    [closeDialog, runLoop, connectionId, bucket]
  );

  const handleTagApply = useCallback(
    async (tags: Array<{ key: string; value: string }>) => {
      closeDialog();
      const fileKeys = selection.filter((o) => !o.isFolder).map((o) => o.key);
      await runLoop(
        "tag",
        fileKeys,
        (k) => k,
        (k) => setObjectTags({ connectionId, bucket, key: k, tags })
      );
    },
    [closeDialog, runLoop, selection, connectionId, bucket]
  );

  const handleDeleteConfirm = useCallback(async () => {
    closeDialog();
    const keys = selection.map((o) => o.key);
    await runLoop(
      "delete",
      keys,
      (k) => k,
      (k) => deleteOneObject({ connectionId, bucket, key: k })
    );
  }, [closeDialog, runLoop, selection, connectionId, bucket]);

  if (!showIdle && !showProgress && !dialogOpen) {
    return null;
  }

  return (
    <>
      {showIdle && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-full border bg-card shadow-lg"
          role="toolbar"
          aria-label="Bulk operations"
        >
          <span className="text-sm font-medium px-2">
            {selectedItems.size} selected
          </span>
          <div className="h-5 w-px bg-border" />
          <Button size="sm" variant="ghost" onClick={() => openDialog("rename", paneId)}>
            <Pencil className="mr-2 h-4 w-4" />
            Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openDialog("tag", paneId)}>
            <Tag className="mr-2 h-4 w-4" />
            Tag
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => openDialog("delete", paneId)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
          <div className="h-5 w-px bg-border" />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => clearSelection(paneId)}
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {showProgress && progress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[min(560px,90vw)] p-3 rounded-xl border bg-card shadow-lg">
          <div className="flex items-center gap-3">
            {progress.finishedAt ? (
              progress.failures.length === 0 ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" />
              )
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {progress.finishedAt ? "Finished" : `${capitalize(progress.kind)} ${progress.completed} / ${progress.total}`}
                {progress.failures.length > 0 &&
                  ` (${progress.failures.length} failed)`}
              </div>
              {progress.currentKey && !progress.finishedAt && (
                <div className="text-xs text-muted-foreground truncate" title={progress.currentKey}>
                  {progress.currentKey}
                </div>
              )}
            </div>
            {!progress.finishedAt ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={requestCancel}
                disabled={progress.cancelRequested}
              >
                {progress.cancelRequested ? "Cancelling…" : "Cancel"}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={dismissProgress}>
                Dismiss
              </Button>
            )}
          </div>
          <div className="mt-2">
            <Progress value={(progress.completed / Math.max(progress.total, 1)) * 100} />
          </div>
          {progress.finishedAt && progress.failures.length > 0 && (
            <div className="mt-2 max-h-32 overflow-y-auto text-xs font-mono border-t pt-2 space-y-1">
              {progress.failures.map((f) => (
                <div key={f.key} className="truncate" title={`${f.key}: ${f.error}`}>
                  <span className="text-destructive">{f.key}</span>: {f.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <BulkRenameDialog
        open={dialog === "rename" && dialogPaneId === paneId}
        onClose={closeDialog}
        selection={selection}
        onApply={handleRenameApply}
      />
      <BulkTagDialog
        open={dialog === "tag" && dialogPaneId === paneId}
        onClose={closeDialog}
        selection={selection}
        onApply={handleTagApply}
      />
      <Dialog
        open={dialog === "delete" && dialogPaneId === paneId}
        onOpenChange={(o) => { if (!o) closeDialog(); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selection.length} item{selection.length !== 1 ? "s" : ""}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the selected objects. Folders are deleted as zero-byte markers; their contents are not removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/browser/bulk-ops-panel.tsx
git commit -m "feat: add bulk operations panel with rename/tag/delete and progress"
```

---

### Task 9: Wire panel into FileBrowser and remove old bulk-delete button

**Files:**
- Modify: `src/components/browser/file-browser.tsx`

Three small edits:
1. Remove the existing toolbar bulk-delete button (`file-browser.tsx:408-418`) and the `handleBulkDelete` function (`file-browser.tsx:326-347`) — the panel replaces both.
2. Import `BulkOpsPanel`.
3. Mount `BulkOpsPanel` near the bottom of the JSX, alongside `UploadZone`.

- [ ] **Step 1: Add the import**

In the existing imports block in `src/components/browser/file-browser.tsx` (top of file), add:

```ts
import { BulkOpsPanel } from "./bulk-ops-panel";
```

- [ ] **Step 2: Remove `handleBulkDelete`**

Delete this entire block from `src/components/browser/file-browser.tsx` (currently lines 326-347):

```ts
const handleBulkDelete = async () => {
  if (!canWrite) return;
  if (selectedItems.size === 0) return;

  try {
    await deleteObjects.mutateAsync(Array.from(selectedItems));
    addNotification({
      type: "delete",
      title: "Deleted",
      description: `Successfully deleted ${selectedItems.size} item(s)`,
      status: "completed",
    });
    clearSelection(paneId);
  } catch (error) {
    addNotification({
      type: "delete",
      title: "Failed to delete",
      error: error instanceof Error ? error.message : "Unknown error",
      status: "error",
    });
  }
};
```

- [ ] **Step 3: Remove the toolbar bulk-delete button**

In `src/components/browser/file-browser.tsx`, delete this block from the toolbar JSX (currently lines 408-418):

```tsx
{canWrite && selectedItems.size > 0 && (
  <Button
    variant="destructive"
    size="sm"
    onClick={handleBulkDelete}
    disabled={deleteObjects.isPending}
  >
    <Trash2 className="mr-2 h-4 w-4" />
    Delete ({selectedItems.size})
  </Button>
)}
```

After this removal, if `Trash2` is no longer used anywhere else in the file, remove it from the `lucide-react` import on line 32. Check by searching the file — if `Trash2` appears nowhere else, drop it from `import { Loader2, RefreshCw, Trash2 } from "lucide-react";` so the import becomes `import { Loader2, RefreshCw } from "lucide-react";`.

- [ ] **Step 4: Mount the panel near `UploadZone`**

In `src/components/browser/file-browser.tsx`, find the `<UploadZone ... />` block (currently lines 509-514) and add `<BulkOpsPanel ... />` immediately after it:

```tsx
<UploadZone
  connectionId={connectionId}
  bucket={bucket}
  currentPath={currentPath}
  disabled={!canWrite}
/>

<BulkOpsPanel
  paneId={paneId}
  connectionId={connectionId}
  bucket={bucket}
  objects={data?.objects || []}
  canWrite={canWrite}
/>
```

- [ ] **Step 5: Verify in the browser**

Run `pnpm dev`. Log in, navigate to a bucket with at least 3 files.

Check each:

1. **Idle panel appears:** Select 2 or more files (via the row checkboxes). The bottom-centered panel should fade/appear at the bottom with "N selected" + Rename / Tag / Delete / Clear. Selecting just 1 item should NOT show the panel. The old toolbar "Delete (N)" button should be gone.

2. **Clear button:** Click `X` on the panel — selection clears, panel hides.

3. **Bulk delete flow:** Select 3 files → panel → Delete → confirm dialog → Delete. Progress bar appears at the bottom showing "Delete 1 / 3", "Delete 2 / 3", "Delete 3 / 3", finishes with "Finished" and a Dismiss button. Files should disappear from the list (query invalidated). A notification appears.

4. **Bulk rename — prefix:** Select 2 files (e.g. `a.jpg`, `b.jpg`) → Rename → choose "Prefix", type `new-`. Preview shows `a.jpg → new-a.jpg`, `b.jpg → new-b.jpg`. Click Rename. Progress runs. After refresh, files are renamed.

5. **Bulk rename — find/replace:** Select files that share a substring. Use Find/Replace. Confirm preview is correct, hit apply, verify result.

6. **Bulk rename — sequence:** Select 3 files. Pick Sequence, base `photo-`, start 1, pad 2. Preview shows `photo-01.<ext>`, `photo-02.<ext>`, `photo-03.<ext>`. Apply, verify.

7. **Bulk rename — duplicate guard:** Use Find/Replace with empty Find string or a transform that produces collisions (e.g. select `a.jpg`, `b.jpg`, set Sequence base = `same`, padTo = 0, startAt = 1 with 2 files → `same1`, `same2` are unique; force collision with Prefix `` and Suffix `` on same-name selection by picking 2 same files in different folders). Confirm the "duplicate names" warning shows and Apply is disabled.

8. **Bulk tag:** Select 2 files → Tag → add `env`=`prod`, `team`=`alpha` → Apply. Progress runs. Verify with AWS CLI or MinIO console that both objects have exactly those tags as their full tag set.

9. **Partial failure path:** Disconnect network mid-run (or temporarily edit the rename route to throw on every other call) and verify the panel completes the rest, shows the failure list, and the notification reflects the error count.

10. **Folder filtering:** Select a mix of files and folders → Rename. Confirm dialog says "(N folders excluded)" and the preview only contains files.

- [ ] **Step 6: Commit**

```bash
git add src/components/browser/file-browser.tsx
git commit -m "feat: mount BulkOpsPanel and remove legacy toolbar bulk-delete"
```

---

## Self-Review

**1. Spec coverage:**
- "Multi-select rename" → Tasks 1, 6, 9 (pattern transform with live preview, applied via single-item rename API).
- "Multi-select tag" → Tasks 4, 7, 9 (key/value editor, full-replace via PutObjectTagging).
- "Multi-select delete with progress" → Tasks 5, 8, 9 (single-item delete reuses existing `/api/objects/delete`, loop drives progress).
- "Bottom-centered panel appearing after multiple file selection" → Task 8 + Task 9 step 5 verification (`fixed bottom-6 left-1/2 -translate-x-1/2`, gated on `selectedItems.size >= 2`).
- "Progress" → Task 2 (store), Task 8 (UI), Task 9 step 5 (verify).

All four user-confirmed design choices are honored: pattern-transform rename, replace-mode tag, per-item client loop, panel replaces the toolbar bulk-delete button.

**2. Placeholder scan:** No TBDs, no "implement error handling", no "similar to Task N". Every code-bearing step contains the actual code. Verification steps name the exact button to click and expected text on screen.

**3. Type consistency:**
- `RenamePattern`, `RenamePreviewItem`, `applyRenamePattern` defined in Task 1, used unchanged in Tasks 6, 8.
- `BulkOpKind`, `BulkOpProgress`, store action names (`startProgress`, `recordSuccess`, etc.) defined in Task 2, used unchanged in Task 8.
- `renameObject`/`setObjectTags`/`deleteOneObject` signatures in Task 5 match the call sites in Task 8.
- API route request shapes (`RenameRequest`, `TagRequest`) in Tasks 3-4 match the client helper bodies in Task 5.
- `S3Object` is the existing shared type from `@/types`.

**4. File-edit line numbers in Task 9:** Derived from the current `file-browser.tsx` (read at the time of planning). If the file has drifted by the time of execution, search for the literal text blocks shown — they are unique.

**5. Scope discipline:** The plan does not add SSE, folder-rename, tag-merge, or per-item edit mode — those were explicitly deferred via the clarification step. No tests are added because the codebase has no test framework; the existing reference plan (`2026-06-03-encrypt-secret-access-key.md`) follows the same approach.
