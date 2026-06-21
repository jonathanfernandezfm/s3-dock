# Plan 013: Add single-file "Rename" to the file browser context menus

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8d46baa..HEAD -- src/components/browser/file-row.tsx src/components/browser/file-tile.tsx src/lib/queries/objects-bulk.ts src/app/api/objects/rename/route.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8d46baa`, 2026-06-21

## Why this matters

Renaming a single file is a baseline file-manager expectation, but the only way to do it today is to *select* the item and use the bulk-action toolbar's pattern-rename dialog (find/replace, prefix, sequence) — heavy machinery for "rename this one thing." The per-item context menus (right-click / three-dot) offer Preview, Tags, Download, Share, Properties, Activity, Versions, History, Delete — but no **Rename**. This plan adds a "Rename…" item to the file context menu in both the list view (`FileRow`) and the grid view (`FileTile`), backed by the existing `/api/objects/rename` endpoint. (Report finding #4.)

**Folders are explicitly out of scope**: the rename endpoint rejects folder keys (`src/app/api/objects/rename/route.ts:34-39` returns 400 for any key ending in `/`), because renaming an S3 "folder" means recursively copying then deleting every object under the prefix — a different operation with no current endpoint. Adding a folder Rename that 400s would be a worse bug. See Maintenance notes.

## Current state

- `src/lib/queries/objects-bulk.ts:39-41` — the rename client already exists and is what the bulk flow uses:
  ```ts
  export async function renameObject(args: RenameArgs): Promise<void> {
    await postJson("/api/objects/rename", args);
  }
  // RenameArgs = { connectionId; bucket; sourceKey; targetKey }
  ```
  and an invalidation hook:
  ```ts
  export function useInvalidateNotesAndObjects() { /* invalidates objects + tags + notes */ }
  ```
- `src/app/api/objects/rename/route.ts` — POST: copies `sourceKey`→`targetKey` then deletes source, records activity, updates the search index and notes. Returns 400 for folder keys, 403 without `canManageFiles`.
- `src/components/browser/file-row.tsx` — list-view row. Its three-dot menu is at lines **281-375** (`<DropdownMenu>` … `<DropdownMenuContent align="end">`). File-only items are guarded by `!object.isFolder`. `canWrite` is a prop (default `true`). It already imports `DropdownMenuItem` and lucide icons (no `Pencil` yet).
- `src/components/browser/file-tile.tsx` — grid-view tile. The **file** menu (not the folder branch) is at lines **323-381** (`<DropdownMenuContent align="end">` inside `{!object.isFolder && …}` at line 310). It already imports `DropdownMenuItem` (no `Pencil` yet).
- The bulk dialog/notification/invalidation pattern to imitate lives in `src/components/browser/bulk-ops-panel.tsx:197-214` (`renameObject` call shape) and `src/lib/stores/notification-store.ts` (`addNotification`).

### Conventions to match

- Dialogs use `@/components/ui/dialog` (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`), `@/components/ui/input` (`Input`), `@/components/ui/label` (`Label`), `@/components/ui/button` (`Button`). See `src/components/browser/bulk-rename-dialog.tsx` and `src/components/browser/create-folder-dialog.tsx` for the exact prop usage.
- Notifications: `const { addNotification } = useNotificationStore();` then `addNotification({ type: "info" | "error", title, description?, status: "completed" | "error" })`.
- Cache invalidation after a mutation: `const invalidate = useInvalidateNotesAndObjects(); … invalidate();`.
- Menu items: `<DropdownMenuItem onClick={…}><Pencil className="h-4 w-4" />Rename…</DropdownMenuItem>` (icon then label, matching every sibling item).
- Pure logic gets a unit test (`vitest`); see `src/lib/bulk-rename.test.ts`.

## Commands you will need

| Purpose   | Command                                   | Expected on success |
|-----------|-------------------------------------------|---------------------|
| Tests     | `pnpm test`                               | all pass (≥469)     |
| One test  | `pnpm test src/lib/rename-key.test.ts`    | pass                |
| Typecheck | `pnpm exec tsc --noEmit`                  | no **new** errors   |
| Lint      | `pnpm lint`                               | no **new** problems |

**Baselines at `8d46baa`** (pre-existing, not yours): tsc → 2 errors in `landing-page.test.tsx`; lint → 27 problems, none in this plan's files; tests → 469 pass.

## Scope

**In scope** (modify/create):
- `src/lib/rename-key.ts` (create — pure helper)
- `src/lib/rename-key.test.ts` (create — tests)
- `src/components/browser/rename-dialog.tsx` (create — single-item dialog)
- `src/components/browser/file-row.tsx` (add menu item + state)
- `src/components/browser/file-tile.tsx` (add menu item + state, file branch only)

**Out of scope** (do NOT touch):
- `src/app/api/objects/rename/route.ts` — endpoint already does the right thing; no server change needed.
- Folder rename anywhere (the folder branch of `FileTile` at lines 151-251, and folder rows in `FileRow`). Folders intentionally get no Rename.
- `bulk-rename-dialog.tsx` / `bulk-ops-panel.tsx` — the bulk flow stays as-is.

## Git workflow

- Branch: `advisor/013-context-menu-rename`
- Conventional commits, e.g. `feat(browser): add single-file rename to context menus`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Pure helper `src/lib/rename-key.ts`

Extract the key math + validation so it's testable:

```ts
export type RenameTarget =
  | { ok: true; targetKey: string }
  | { ok: false; error: string };

/** Compute the new full object key when renaming just the basename of `sourceKey`. */
export function computeRenameTarget(sourceKey: string, newName: string): RenameTarget {
  const trimmed = newName.trim();
  if (trimmed.length === 0) return { ok: false, error: "Name cannot be empty" };
  if (trimmed.includes("/")) return { ok: false, error: "Name cannot contain '/'" };
  const slash = sourceKey.lastIndexOf("/");
  const prefix = slash === -1 ? "" : sourceKey.slice(0, slash + 1);
  const currentName = slash === -1 ? sourceKey : sourceKey.slice(slash + 1);
  if (trimmed === currentName) return { ok: false, error: "unchanged" };
  return { ok: true, targetKey: prefix + trimmed };
}

/** The basename portion of an object key (no trailing slash handling needed for files). */
export function basename(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}
```

**Verify**: `pnpm exec tsc --noEmit` → no new errors.

### Step 2: Tests for the helper — `src/lib/rename-key.test.ts`

Model after `src/lib/bulk-rename.test.ts`. Cover:
- `computeRenameTarget("a/b/old.txt", "new.txt")` → `{ ok: true, targetKey: "a/b/new.txt" }`
- top-level key: `computeRenameTarget("old.txt", "new.txt")` → `targetKey: "new.txt"`
- empty name → `{ ok: false, error: "Name cannot be empty" }`
- name with slash → `{ ok: false, error: "Name cannot contain '/'" }`
- unchanged name → `{ ok: false, error: "unchanged" }`
- `basename("a/b/c.png")` → `"c.png"`; `basename("c.png")` → `"c.png"`

**Verify**: `pnpm test src/lib/rename-key.test.ts` → all pass.

### Step 3: Single-item dialog `src/components/browser/rename-dialog.tsx`

Create a `"use client"` component. Target shape:

```tsx
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameObject, useInvalidateNotesAndObjects } from "@/lib/queries/objects-bulk";
import { useNotificationStore } from "@/lib/stores/notification-store";
import { computeRenameTarget, basename } from "@/lib/rename-key";

interface RenameDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  bucket: string;
  objectKey: string; // a FILE key (never ends with "/")
}

export function RenameDialog({ open, onClose, connectionId, bucket, objectKey }: RenameDialogProps) {
  const [name, setName] = useState(() => basename(objectKey));
  const [submitting, setSubmitting] = useState(false);
  const { addNotification } = useNotificationStore();
  const invalidate = useInvalidateNotesAndObjects();

  const result = computeRenameTarget(objectKey, name);
  const canApply = result.ok && !submitting;

  async function handleApply() {
    if (!result.ok) return;
    setSubmitting(true);
    try {
      await renameObject({ connectionId, bucket, sourceKey: objectKey, targetKey: result.targetKey });
      addNotification({ type: "info", title: "File renamed", description: `${basename(objectKey)} → ${name.trim()}`, status: "completed" });
      invalidate();
      onClose();
    } catch (error) {
      addNotification({
        type: "error",
        title: "Rename failed",
        error: error instanceof Error ? error.message : "Unknown error",
        status: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
          <DialogDescription>Enter a new name. The file stays in the same folder.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="rename-input">New name</Label>
          <Input
            id="rename-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canApply) handleApply(); }}
          />
          {!result.ok && result.error !== "unchanged" && (
            <p className="text-sm text-destructive">{result.error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={!canApply}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Before writing, **open `src/lib/stores/notification-store.ts`** and confirm the `addNotification` argument shape (the `error` field on the error notification, and `type`/`status` enums). Match it exactly; if the error variant differs, adapt the error `addNotification` call to the real shape (this is the only spot likely to need adjustment). The success notification shape (`type: "info"`, `status: "completed"`) is copied from `bulk-ops-panel.tsx:169-176`.

**Verify**: `pnpm exec tsc --noEmit` → no new errors.

### Step 4: Wire into `FileRow` (list view)

In `src/components/browser/file-row.tsx`:
1. Add `Pencil` to the `lucide-react` import.
2. Add `import { RenameDialog } from "./rename-dialog";`.
3. Add state near the other `useState` calls (around line 123): `const [renameOpen, setRenameOpen] = useState(false);`.
4. Add a menu item **inside** the file-only area of `<DropdownMenuContent>` — place it just after the `Share…` item block (ends ~line 320) and gate it the same way the bulk Rename is gated (by `canWrite`), and by `!object.isFolder`:
   ```tsx
   {!object.isFolder && canWrite && (
     <DropdownMenuItem onClick={() => setRenameOpen(true)}>
       <Pencil className="h-4 w-4" />
       Rename…
     </DropdownMenuItem>
   )}
   ```
5. Render the dialog near the existing `{shareOpen && …}` / `{tagsOpen && …}` blocks at the end of the component (before the closing `</TableRow>`):
   ```tsx
   {renameOpen && !object.isFolder && (
     <RenameDialog
       open={renameOpen}
       onClose={() => setRenameOpen(false)}
       connectionId={connectionId}
       bucket={bucket}
       objectKey={object.key}
     />
   )}
   ```

**Verify**: `pnpm exec tsc --noEmit` → no new errors. `grep -n "Rename" src/components/browser/file-row.tsx` → shows the new item.

### Step 5: Wire into `FileTile` (grid view, file branch only)

In `src/components/browser/file-tile.tsx`:
1. Add `Pencil` to the `lucide-react` import.
2. Add `import { RenameDialog } from "./rename-dialog";`.
3. Add state near the other `useState` calls (around line 98): `const [renameOpen, setRenameOpen] = useState(false);`.
4. Add the menu item inside the **file** `<DropdownMenuContent>` (lines 323-381), after the `Share…` item (~line 350). Gate by `canWrite` (the whole menu is already in the `!object.isFolder` branch, so no folder check needed):
   ```tsx
   {canWrite && (
     <DropdownMenuItem onClick={() => setRenameOpen(true)}>
       <Pencil className="h-4 w-4" />
       Rename…
     </DropdownMenuItem>
   )}
   ```
5. Render the dialog next to the existing `{shareOpen && …}` block near the end of the **file** return (before the final `</div>`):
   ```tsx
   {renameOpen && (
     <RenameDialog
       open={renameOpen}
       onClose={() => setRenameOpen(false)}
       connectionId={connectionId}
       bucket={bucket}
       objectKey={object.key}
     />
   )}
   ```
   Do **not** add anything to the folder branch (lines 151-251).

**Verify**: `pnpm exec tsc --noEmit` → no new errors. `grep -n "Rename" src/components/browser/file-tile.tsx` → shows the new item (and confirm it's not in the folder branch by checking the line number is > 309).

## Test plan

- **`src/lib/rename-key.test.ts`** — the cases in Step 2 (happy path, top-level, empty, slash, unchanged, basename).
- No component/integration test is required (the repo has no React-testing harness for these browser components; `@testing-library/react` exists but is used only for landing/simple components). The pure helper carries the logic that can break.
- Verification: `pnpm test` → all pass, including the new file.

## Done criteria

ALL must hold:

- [ ] `pnpm test` exits 0; `src/lib/rename-key.test.ts` exists and passes
- [ ] `pnpm exec tsc --noEmit` shows only the 2 pre-existing `landing-page.test.tsx` errors
- [ ] `pnpm lint` adds no new problems in the touched files
- [ ] "Rename…" appears in the file three-dot menu in **both** `file-row.tsx` and `file-tile.tsx`, and **not** for folders (`grep -n "Rename" src/components/browser/file-tile.tsx` line number > 309)
- [ ] No new server route or change to `src/app/api/objects/rename/route.ts`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts/line ranges don't match the live code (drift since `8d46baa`).
- `addNotification`'s real signature in `notification-store.ts` can't accommodate the success/error calls as written and the right shape isn't obvious — report the actual type.
- You find the rename endpoint no longer rejects folders / now supports prefix rename — that changes the folder decision; report it rather than implementing folder rename yourself.
- A verification fails twice after a reasonable fix.

## Maintenance notes

- **Folder rename** is deliberately absent. To add it later you need a new server operation that lists every object under the prefix and copy+deletes each (a recursive move), plus progress UI — model it on the bulk delete/rename loop in `bulk-ops-panel.tsx`. Until that exists, do not surface a folder Rename.
- The dialog reuses `renameObject` + `useInvalidateNotesAndObjects`, so it automatically benefits from any future improvement to rename (e.g. server-side conflict checks). A reviewer should confirm the new menu items are gated by `canWrite` exactly like the bulk Rename button and that nothing was added to the folder code paths.
- If a "file already exists" guard is added server-side, surface its 4xx message via the existing error notification (already wired).
