# Plan 015: UX polish bundle — refresh tooltip, billing meter min-width, lifecycle "Soon" badge, clickable connection card, incomplete-uploads deep link

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. These five changes are **independent** — if one hits a STOP
> condition, you may still complete the others; record which you skipped. If
> anything in the "STOP conditions" section occurs for a sub-task, stop that
> sub-task and report — do not improvise. When done, update the status row for
> this plan in `plans/README.md` — unless a reviewer dispatched you and told
> you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8d46baa..HEAD -- src/components/browser/file-browser.tsx src/components/billing/billing-tab.tsx src/components/buckets/bucket-detail-tabs.tsx src/components/connections/connection-list.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch for a given sub-task, treat it as a STOP for that sub-task only.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8d46baa`, 2026-06-21

## Why this matters

Five small, independent UX defects, each low-risk:

- **A (finding #9)** — the file-browser refresh button is icon-only with **no** `aria-label`/`title`; users (and screen readers) can't tell what it does.
- **B (finding #12)** — the billing "Operations" usage meter renders as an invisible hairline: `Math.round(17/50000*100) = 0` → `width: 0%`, so any tiny-but-nonzero usage shows nothing.
- **C (finding #16)** — the bucket "Lifecycle rules" tab looks identical to working tabs but only shows "coming soon" after you click. A "Soon" badge on the tab sets expectations before the click. (The feature itself is plan 002; this is the interim signal.)
- **D (finding #17)** — connection cards aren't clickable: only the gear icon navigates, with no hover/cursor affordance, so the obvious target (the card) does nothing.
- **E (finding #2)** — deep-linking the bucket "Incomplete uploads" tab via `?tab=incomplete-uploads` silently renders Overview, because the tab's internal key is `multipart` and the human-readable slug isn't recognized. (The reported "does nothing on first click" is **not** reproducible in the current code — the tab state is fully URL-driven via `router.push` — so the concrete remaining defect is the deep-link alias.)

## Current state

### A — refresh button
`src/components/browser/file-browser.tsx:594-596`:
```tsx
<Button variant="outline" size="icon" onClick={() => refetch()}>
  <RefreshCw className="h-4 w-4" />
</Button>
```
Pattern to match: native `title` is used for icon controls elsewhere (e.g. `src/components/browser/file-row.tsx:276` `title="Properties"`, `breadcrumb.tsx` `title={bucket}`).

### B — billing meter
`src/components/billing/billing-tab.tsx:26-61` (`UsageMeter`):
```tsx
const pct = unlimited ? 0 : Math.min(100, Math.round((current / limit) * 100));
…
<div className="h-1.5 w-full rounded-full bg-muted">
  <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
</div>
```

### C & E — bucket detail tabs
`src/components/buckets/bucket-detail-tabs.tsx`:
- Tab list (lines 14-25), `as const`, drives the `TabKey` type and `isTabKey`:
  ```tsx
  const TAB_DEFINITIONS = [
    { key: "overview", label: "Overview", icon: BarChart3 },
    { key: "multipart", label: "Incomplete uploads", icon: RefreshCw },
    { key: "lifecycle", label: "Lifecycle rules", icon: Repeat },
    { key: "permissions", label: "Permissions", icon: Lock },
  ] as const;
  type TabKey = (typeof TAB_DEFINITIONS)[number]["key"];
  function isTabKey(value: string | null): value is TabKey { … }
  ```
- Active-tab resolution (line 36): `const activeTab: TabKey = isTabKey(rawTab) ? rawTab : "overview";`
- Nav render (lines 67-84) maps `TAB_DEFINITIONS` to `<button>`s.

### D — connection card
`src/components/connections/connection-list.tsx:184-248` — each card:
```tsx
<Card key={connection.id} id={`connection-${connection.id}`} className="p-3">
  <div className="flex items-start justify-between gap-2">
    …{getDisplayName}…role…
    <div className="flex items-center gap-0.5 shrink-0">
      <Button … asChild><Link href={`/app/connections/${connection.id}?tab=overview`}><Settings …/></Link></Button>
      {canManage(connection) && (<DropdownMenu>…Edit / Delete…</DropdownMenu>)}
    </div>
  </div>
  <p …>{connection.endpoint}</p>
  <div …><SearchIndexStatus connectionId={connection.id} /></div>
</Card>
```
The component is `"use client"` and already imports `Link` from `next/link`. It does **not** yet import `useRouter`.

### Conventions to match
- `"use client"` components, Tailwind + `cn()`.
- Navigation: `import { useRouter } from "next/navigation";` then `router.push(href)`.
- Pure helpers get a `vitest` test (see `src/lib/bulk-rename.test.ts`).

## Commands you will need

| Purpose   | Command                                               | Expected on success |
|-----------|-------------------------------------------------------|---------------------|
| Tests     | `pnpm test`                                           | all pass (≥469)     |
| One test  | `pnpm test src/components/buckets/bucket-tab-key.test.ts` | pass            |
| Typecheck | `pnpm exec tsc --noEmit`                              | no **new** errors   |
| Lint      | `pnpm lint`                                           | no **new** problems |

**Baselines at `8d46baa`** (pre-existing, not yours): tsc → 2 errors in `landing-page.test.tsx`; lint → 27 problems, none in this plan's files; tests → 469 pass.

## Scope

**In scope** (modify/create):
- `src/components/browser/file-browser.tsx` (sub-task A)
- `src/components/billing/billing-tab.tsx` (sub-task B)
- `src/components/buckets/bucket-detail-tabs.tsx` (sub-tasks C, E)
- `src/components/buckets/bucket-tab-key.ts` (create — sub-task E helper)
- `src/components/buckets/bucket-tab-key.test.ts` (create — tests)
- `src/components/connections/connection-list.tsx` (sub-task D)

**Out of scope** (do NOT touch):
- The lifecycle feature implementation — that is plan 002. Here you only badge the tab.
- The Clerk "Development mode" badge (report #18): it's driven by using a `pk_test_` publishable key, not by code — resolution is using a production Clerk instance. No code change; do not attempt one.
- The breadcrumb tooltip (report #14): already implemented (`breadcrumb.tsx:106` has `title={bucket}`). Leave it.
- Any change to `SearchIndexStatus`, the dropdown menu contents, or the billing meter's value computation beyond the width fix.

## Git workflow

- Branch: `advisor/015-ux-polish-bundle`
- One commit per sub-task is fine, e.g. `fix(billing): give usage meter a minimum visible width`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step A: Label the refresh button (`file-browser.tsx:594-596`)

Add `aria-label` and `title`:
```tsx
<Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh" title="Refresh">
  <RefreshCw className="h-4 w-4" />
</Button>
```
**Verify**: `grep -n 'aria-label="Refresh"' src/components/browser/file-browser.tsx` → match; `pnpm exec tsc --noEmit` → no new errors.

### Step B: Give the billing meter a minimum visible width (`billing-tab.tsx`)

Replace the `pct` line and the filled-bar div so non-zero usage always shows at least a sliver. Compute width unrounded; keep rounding only for the color threshold:
```tsx
const ratio = unlimited ? 0 : Math.min(1, current / Math.max(limit, 1));
const pct = ratio * 100;
const roundedPct = Math.round(pct);
const barColor =
  roundedPct >= 100 ? "bg-red-500" : roundedPct >= 80 ? "bg-amber-500" : "bg-blue-500";
```
and the filled div:
```tsx
<div
  className={`h-1.5 rounded-full transition-all ${barColor} ${current > 0 ? "min-w-[2px]" : ""}`}
  style={{ width: `${pct}%` }}
/>
```
(The `min-w-[2px]` guarantees a visible bar whenever `current > 0`, even when `pct` is far below 1%.)

**Verify**: `pnpm exec tsc --noEmit` → no new errors; `grep -n 'min-w-\[2px\]' src/components/billing/billing-tab.tsx` → match.

### Step E (do before C — same file): tab-key helper + deep-link alias

1. Create `src/components/buckets/bucket-tab-key.ts`:
```ts
export const BUCKET_TAB_KEYS = ["overview", "multipart", "lifecycle", "permissions"] as const;
export type BucketTabKey = (typeof BUCKET_TAB_KEYS)[number];

// Human-readable URL slugs that map onto an internal tab key.
const ALIASES: Record<string, BucketTabKey> = {
  "incomplete-uploads": "multipart",
};

export function isBucketTabKey(value: string | null): value is BucketTabKey {
  return value !== null && (BUCKET_TAB_KEYS as readonly string[]).includes(value);
}

export function resolveBucketTab(value: string | null): BucketTabKey {
  if (isBucketTabKey(value)) return value;
  if (value && value in ALIASES) return ALIASES[value];
  return "overview";
}
```
2. In `bucket-detail-tabs.tsx`, import and use it:
   - Add `import { resolveBucketTab, type BucketTabKey } from "./bucket-tab-key";`
   - Delete the local `type TabKey = …` and `function isTabKey(…)` (lines 21-25).
   - Replace line 36 with: `const activeTab: BucketTabKey = resolveBucketTab(rawTab);`
   - Change `setTab`'s parameter type from `TabKey` to `BucketTabKey` (line 42).
   - The `TAB_DEFINITIONS` keys already equal `BUCKET_TAB_KEYS`; leave the `as const` definition in place (it still types the nav render). If TypeScript complains that a `TAB_DEFINITIONS` key isn't assignable to `BucketTabKey`, the two lists have diverged — STOP and report.

**Verify**: `pnpm exec tsc --noEmit` → no new errors.

### Step C: "Soon" badge on the Lifecycle tab (`bucket-detail-tabs.tsx`)

1. Add a `badge` to the lifecycle entry only:
```tsx
{ key: "lifecycle", label: "Lifecycle rules", icon: Repeat, badge: "Soon" },
```
2. In the nav `.map` (lines 67-84), read the optional badge and render it after the label. Change the map callback to take the whole definition:
```tsx
{TAB_DEFINITIONS.map((def) => {
  const { key, label, icon: Icon } = def;
  const badge = "badge" in def ? def.badge : undefined;
  return (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm border-b-2 transition-colors",
        key === activeTab
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {badge && (
        <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  );
})}
```
(`"badge" in def` narrows the union so `def.badge` typechecks because only the lifecycle entry has it.)

**Verify**: `pnpm exec tsc --noEmit` → no new errors; `grep -n '"Soon"' src/components/buckets/bucket-detail-tabs.tsx` → match.

### Step D: Make the connection card clickable (`connection-list.tsx`)

1. Add `import { useRouter } from "next/navigation";` and, inside `ConnectionList`, `const router = useRouter();` (near the other hooks, ~line 48).
2. Make the `<Card>` (line 185-189) navigate on click with hover affordance:
```tsx
<Card
  key={connection.id}
  id={`connection-${connection.id}`}
  className="p-3 cursor-pointer transition-colors hover:bg-accent/50"
  onClick={() => router.push(`/app/connections/${connection.id}?tab=overview`)}
>
```
3. Prevent the action buttons (gear + dropdown) from also triggering the card navigation: on the actions container (line 200, `<div className="flex items-center gap-0.5 shrink-0">`) add `onClick={(e) => e.stopPropagation()}`:
```tsx
<div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
```
Leave the gear `<Link>` and the `DropdownMenu` as-is (the dropdown content is portaled, so its Edit/Delete clicks won't bubble to the card; the `stopPropagation` covers the trigger and gear).

**Verify**: `pnpm exec tsc --noEmit` → no new errors; `grep -n "useRouter" src/components/connections/connection-list.tsx` → match.

## Test plan

- **`src/components/buckets/bucket-tab-key.test.ts`** (create) — model after `src/lib/bulk-rename.test.ts`. Cover:
  - `resolveBucketTab("incomplete-uploads")` → `"multipart"` (the deep-link fix)
  - `resolveBucketTab("multipart")` → `"multipart"`
  - `resolveBucketTab("permissions")` → `"permissions"`
  - `resolveBucketTab(null)` → `"overview"`
  - `resolveBucketTab("bogus")` → `"overview"`
  - `isBucketTabKey("overview")` → true; `isBucketTabKey("incomplete-uploads")` → false
- The other four sub-tasks are visual/markup; no unit test (the repo has no harness for these components). They're covered by `tsc`/`lint`/`grep` checks and the manual checks in Done criteria.
- Verification: `pnpm test` → all pass including the new file.

## Done criteria

ALL must hold:

- [ ] `pnpm test` exits 0; `bucket-tab-key.test.ts` exists and passes
- [ ] `pnpm exec tsc --noEmit` shows only the 2 pre-existing `landing-page.test.tsx` errors
- [ ] `pnpm lint` adds no new problems in touched files
- [ ] A: refresh button has `aria-label="Refresh"` and `title="Refresh"`
- [ ] B: `min-w-[2px]` present on the filled meter div; width uses unrounded `pct`
- [ ] C: lifecycle tab renders a "Soon" badge
- [ ] D: connection `<Card>` has `cursor-pointer`, a hover class, and an `onClick` that navigates; actions container stops propagation
- [ ] E: `resolveBucketTab("incomplete-uploads") === "multipart"` (test proves it); `bucket-detail-tabs.tsx` uses `resolveBucketTab`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop the affected sub-task and report (do not improvise) if:

- A sub-task's "Current state" excerpt doesn't match the live code (drift since `8d46baa`).
- (E/C) `TAB_DEFINITIONS` keys no longer equal `BUCKET_TAB_KEYS`, or removing the local `TabKey`/`isTabKey` breaks other references in the file you can't trivially repoint.
- (D) The card already has an `onClick`/navigation wrapper (someone fixed it) — leave it; report.
- Any verification fails twice after a reasonable fix.

## Maintenance notes

- When plan 002 ships real lifecycle rules, **remove the `badge: "Soon"`** from the lifecycle entry in `bucket-detail-tabs.tsx`.
- The `ALIASES` map in `bucket-tab-key.ts` is the place to add future human-readable deep-link slugs; keep internal keys (`multipart`) stable so existing links don't break, and add slugs as aliases rather than renaming keys.
- Reviewer should confirm clicking the connection card's Edit/Delete dropdown does **not** also navigate (propagation is stopped), and that the billing meter still caps at 100% width for over-limit usage.
- The Clerk "Development mode" badge (#18) is intentionally not addressed in code — note in the PR description that it requires a production Clerk instance (`pk_live_…` key), an ops/deployment task.
