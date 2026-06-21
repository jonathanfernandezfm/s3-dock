# Plan 014: Gate the Shares "Copy" button by status and add per-row management actions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8d46baa..HEAD -- src/components/shares/share-list-table.tsx src/lib/queries/share-links.ts src/app/api/share-links`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8d46baa`, 2026-06-21

## Why this matters

The Shares table shows a fully-functional **Copy** button on **expired, exhausted, and revoked** links, identical to active ones. Copying a dead link hands someone a URL that 403s/404s — a confusing failure that surfaces only on the recipient's end (finding #10). And the only management action on a row is **Revoke** (shown for active links); there's no way to **extend** a link that's about to lapse or has just lapsed, so users must delete and recreate (finding #11). This plan (1) shows Copy only for usable (active) links, and (2) adds an **Extend (+7 days)** action for active/expired links, reusing the existing `PATCH /api/share-links/[id]` endpoint.

## Current state

- `src/components/shares/share-list-table.tsx` — the table. Status is already known per row (`s.status` is `"active" | "expired" | "exhausted" | "revoked"`, computed server-side). The action cell (lines **74-99**):
  ```tsx
  <TableCell className="text-right">
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" className="h-7 w-[72px] gap-1 text-xs"
        onClick={() => handleCopy(s.id, `${window.location.origin}/s/${s.slug}`)}>
        {copiedId === s.id ? (…Copied…) : (…Copy…)}
      </Button>
      {s.status === "active" && (
        <Button … onClick={() => revoke.mutate(s.id)}>Revoke</Button>
      )}
    </div>
  </TableCell>
  ```
  The Copy button is rendered **unconditionally** (line 76); Revoke is already gated to `active` (line 88).
- `src/lib/queries/share-links.ts` — hooks. `useShareLinks` (list), `useRevokeShareLink` (`DELETE /api/share-links/{id}` → soft revoke), `useCreateShareLink`. The `ShareLinkResponse` type (lines 7-23) includes `status`. There is **no edit/PATCH hook yet** — you add one.
- `src/app/api/share-links/[id]/route.ts` — `PATCH` (lines 72-114) accepts `{ expiresAt?, password?, maxUses?, description? }` and returns the updated `shareLink` with a fresh `status`; `DELETE` (lines 116-135) soft-revokes (sets `revokedAt`). Both authorize via `loadAndAuthorize`.
- `src/lib/share-links/status.ts` — `computeStatus(link, now)` derives status from `revokedAt` / `expiresAt` / `useCount`/`maxUses` (read it to confirm the status union).

### Conventions to match

- Mutations are React Query hooks in `src/lib/queries/share-links.ts`, invalidating `queryKeys.shareLinks.all` on success (see `useRevokeShareLink`, lines 97-109). Match that exactly.
- The table is `"use client"`; buttons use `@/components/ui/button` `variant="ghost" size="sm"` with `text-xs` and `h-7`.
- Pure decision logic goes in `src/lib/` with a `vitest` test (see `src/lib/bulk-rename.test.ts` for style).

## Commands you will need

| Purpose   | Command                                          | Expected on success |
|-----------|--------------------------------------------------|---------------------|
| Tests     | `pnpm test`                                      | all pass (≥469)     |
| One test  | `pnpm test src/lib/share-links/row-actions.test.ts` | pass             |
| Typecheck | `pnpm exec tsc --noEmit`                         | no **new** errors   |
| Lint      | `pnpm lint`                                      | no **new** problems |

**Baselines at `8d46baa`** (pre-existing, not yours): tsc → 2 errors in `landing-page.test.tsx`; lint → 27 problems, none in this plan's files; tests → 469 pass.

## Scope

**In scope** (modify/create):
- `src/lib/share-links/row-actions.ts` (create — pure per-status action policy)
- `src/lib/share-links/row-actions.test.ts` (create — tests)
- `src/lib/queries/share-links.ts` (add `useEditShareLink`)
- `src/components/shares/share-list-table.tsx` (gate Copy, add Extend)

**Out of scope** (do NOT touch):
- `src/app/api/share-links/**` — endpoints already support everything needed.
- `src/components/shares/share-dialog.tsx` — creation flow, unrelated (its date format is handled by plan 012).
- A "View details / events" panel — deferred (see Maintenance notes); the GET-with-events endpoint exists but a details UI is a separate, larger change.
- Hard delete — the backend's DELETE is a *soft revoke*; do not invent a destructive delete.

## Git workflow

- Branch: `advisor/014-shares-row-actions`
- Conventional commits, e.g. `fix(shares): gate copy by status; add extend action`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Pure action policy `src/lib/share-links/row-actions.ts`

Define the status union locally (do **not** import from the `"use client"` queries module into a pure lib) and the per-status policy:

```ts
export type ShareStatus = "active" | "expired" | "exhausted" | "revoked";

/** Copy should only be offered for a link that actually works. */
export function canCopyShare(status: ShareStatus): boolean {
  return status === "active";
}

/** Extending the expiry is meaningful for a live link or one that lapsed by time. */
export function canExtendShare(status: ShareStatus): boolean {
  return status === "active" || status === "expired";
}

/** Revoke only a still-active link (others are already unusable). */
export function canRevokeShare(status: ShareStatus): boolean {
  return status === "active";
}

/** New expiry when the user clicks "Extend": one week from now. */
export const EXTEND_BY_MS = 7 * 24 * 60 * 60 * 1000;
```

**Verify**: `pnpm exec tsc --noEmit` → no new errors.

### Step 2: Tests — `src/lib/share-links/row-actions.test.ts`

Model after `src/lib/bulk-rename.test.ts`. Assert:
- `canCopyShare`: true only for `"active"`; false for `expired`/`exhausted`/`revoked`.
- `canExtendShare`: true for `active` and `expired`; false for `exhausted`/`revoked`.
- `canRevokeShare`: true only for `active`.

**Verify**: `pnpm test src/lib/share-links/row-actions.test.ts` → pass.

### Step 3: Add `useEditShareLink` to `src/lib/queries/share-links.ts`

After `useRevokeShareLink`, add:

```ts
export function useEditShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: { expiresAt?: string | null; maxUses?: number | null; description?: string | null };
    }) => {
      const r = await fetch(`/api/share-links/${args.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.patch),
      });
      if (!r.ok) throw new Error("Failed to update share link");
      return (await r.json()) as { shareLink: ShareLinkResponse };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.shareLinks.all });
    },
  });
}
```

(`useMutation`, `useQueryClient`, `queryKeys`, and `ShareLinkResponse` are already imported/defined in this file.)

**Verify**: `pnpm exec tsc --noEmit` → no new errors.

### Step 4: Update the table action cell in `share-list-table.tsx`

1. Add to the existing imports:
   - from `@/lib/queries/share-links`: add `useEditShareLink` to the existing import.
   - `import { canCopyShare, canExtendShare, canRevokeShare, EXTEND_BY_MS } from "@/lib/share-links/row-actions";`
2. In the component body, near `const revoke = useRevokeShareLink();`, add `const edit = useEditShareLink();`.
3. Replace the action cell (lines 74-99) so Copy is gated and Extend is added:

```tsx
<TableCell className="text-right">
  <div className="flex items-center justify-end gap-1">
    {canCopyShare(s.status) && (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-[72px] gap-1 text-xs"
        onClick={() => handleCopy(s.id, `${window.location.origin}/s/${s.slug}`)}
      >
        {copiedId === s.id ? (
          <><Check className="h-3 w-3 text-green-600" /><span className="text-green-600">Copied</span></>
        ) : (
          <><Copy className="h-3 w-3" />Copy</>
        )}
      </Button>
    )}
    {canExtendShare(s.status) && (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        disabled={edit.isPending}
        onClick={() =>
          edit.mutate({
            id: s.id,
            patch: { expiresAt: new Date(Date.now() + EXTEND_BY_MS).toISOString() },
          })
        }
      >
        Extend
      </Button>
    )}
    {canRevokeShare(s.status) && (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-destructive hover:text-destructive"
        onClick={() => revoke.mutate(s.id)}
      >
        Revoke
      </Button>
    )}
  </div>
</TableCell>
```

Note: a revoked/exhausted row now shows **no** action buttons — that is intended (nothing useful can be done to it from this list). The status badge in the prior cell already communicates why.

**Verify**: `pnpm exec tsc --noEmit` → no new errors. `grep -n "canCopyShare" src/components/shares/share-list-table.tsx` → match.

## Test plan

- **`src/lib/share-links/row-actions.test.ts`** — the policy matrix from Step 2.
- No component test (no React-testing harness wired for shares components). The status→action policy is the breakable logic and is fully covered by the pure tests.
- Verification: `pnpm test` → all pass including the new file.

## Done criteria

ALL must hold:

- [ ] `pnpm test` exits 0; `row-actions.test.ts` exists and passes
- [ ] `pnpm exec tsc --noEmit` shows only the 2 pre-existing `landing-page.test.tsx` errors
- [ ] `pnpm lint` adds no new problems in touched files
- [ ] Copy renders only when `canCopyShare(s.status)` (i.e. status `active`); Extend renders for active/expired; Revoke unchanged
- [ ] `useEditShareLink` exists in `src/lib/queries/share-links.ts` and invalidates `queryKeys.shareLinks.all`
- [ ] No `src/app/api/**` changes (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts/line ranges don't match the live code (drift since `8d46baa`).
- The status union in `src/lib/share-links/status.ts` differs from `"active" | "expired" | "exhausted" | "revoked"` — reconcile `ShareStatus` to the real union and report.
- `PATCH /api/share-links/[id]` rejects an `expiresAt`-only body (it shouldn't — the body fields are all optional) — report the response.
- A verification fails twice after a reasonable fix.

## Maintenance notes

- **Extend** sets expiry to *now + 7 days* (`EXTEND_BY_MS`). If product wants "extend from current expiry" or a user-chosen duration, change the `patch.expiresAt` computation (and consider a small dropdown of durations). The hook (`useEditShareLink`) already accepts arbitrary patches.
- **View details / access events** is deferred: `GET /api/share-links/[id]` already returns the link plus its `events`; a details drawer/modal could consume it. That's the natural next plan if share analytics is wanted.
- Reviewer should confirm no action button is shown for `revoked`/`exhausted` rows and that Extend's `disabled={edit.isPending}` prevents double-submits.
