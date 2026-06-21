# Plan 012: Standardize date & number formatting on a fixed locale (fixes locale hydration, mixed formats, missing year)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8d46baa..HEAD -- src/lib/utils.ts src/components/info-drawer/format-time.ts src/components/shares src/components/buckets src/components/connections src/components/billing src/app/app/settings/page.tsx`
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

The app formats dates and numbers with the *runtime's* locale — `toLocaleDateString(undefined, …)` and bare `toLocaleString()`. On a Spanish browser this yields `17 abr 2026`; alongside other call sites that hardcode `"en-US"` ("Jun 5"), bare `toLocaleDateString()` (`5/6/2026`), and ISO (`2026-06-06`), the same screen shows three different date styles. Worse, locale-dependent formatting runs during server-side rendering with the *server's* locale and again on the client with the *browser's* locale; when they differ, React throws a recoverable **hydration mismatch** ("server rendered HTML didn't match the client") — the noisy overlay reported on the Connections page. Pinning every user-facing date/number to one fixed locale makes SSR and client output identical (killing the mismatch) and makes formats consistent across the app. We also add the year to activity dates and a full-timestamp tooltip so "Jun 5" is no longer ambiguous.

This plan addresses report findings #5 (inconsistent/mixed-locale dates), #15 (activity dates missing year/tooltip), and the most likely cause of #1 (Connections hydration overlay). Note #1's exact mismatched DOM node was **not** confirmed by static analysis — see the STOP/verify note in Step 6.

## Current state

Locale-dependent **date** call sites (user-facing):

- `src/lib/utils.ts:20-29` — the shared `formatDate`, used widely, with a **runtime** locale:
  ```ts
  export function formatDate(date: Date | string): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }
  ```
- `src/components/info-drawer/format-time.ts:1-15` — activity relative time; older dates render **without a year**:
  ```ts
  export function formatRelativeTime(isoString: string): string {
    // …relative branches…
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); // "Jun 5"
  }
  ```
- `src/components/shares/share-list-table.tsx:71` — `{s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : "Never"}` (bare → runtime locale)
- `src/components/shares/share-dialog.tsx:111` — `expires {new Date(s.expiresAt).toLocaleDateString()}` (bare)
- `src/components/buckets/multipart-uploads-tab.tsx:214` — `<div>{new Date(u.initiated).toLocaleDateString()}</div>` (bare)
- `src/app/app/settings/page.tsx:27` — already hardcodes `"en-US"`, format `{ month: "long", year: "numeric" }` ("June 2026"). Leave the *format* (it's intentional for "member since"), but route it through the shared helper for one source of truth.

Locale-dependent **number** call sites (`toLocaleString()` → runtime locale; thousands separators differ by locale, a real SSR/client divergence):

- `src/components/connections/search-index-status.tsx:13,15,18` — `data.indexed.toLocaleString()` (this is a `"use client"` component rendered on the Connections page; prime hydration suspect)
- `src/components/connections/connection-indexing-card.tsx:113,135` — `data.indexed.toLocaleString()`
- `src/components/buckets/overview-storage-stats-card.tsx:76,104` — `.toLocaleString()`
- `src/components/billing/billing-tab.tsx:129` — `formatValue={(n) => n.toLocaleString()}`

ISO-style (acceptable, locale-independent — **leave as-is**): `search-results-group.tsx:34` (`toISOString().slice(0,10)`), and the `title={new Date(...).toISOString()}` tooltips in `activity-tab.tsx:98,140` and `notes-tab.tsx:87`.

### Conventions to match

- Pure helpers live in `src/lib/utils.ts` and have unit tests in `src/lib/utils.test.ts` (already exists — read it for the test style; it uses `import { describe, it, expect } from "vitest"`).
- The app is English ("S3 Dock"); `"en-US"` is already the de-facto display locale (`format-time.ts`, `settings/page.tsx`). Standardize on `"en-US"`.
- Components are `"use client"`; keep them so. No new dependencies.

## Commands you will need

| Purpose   | Command                                   | Expected on success |
|-----------|-------------------------------------------|---------------------|
| Tests     | `pnpm test`                               | all pass (≥469)     |
| One test  | `pnpm test src/lib/utils.test.ts`         | pass                |
| Typecheck | `pnpm exec tsc --noEmit`                  | no **new** errors (see baseline) |
| Lint      | `pnpm lint`                               | no **new** problems (see baseline) |

**Baselines at commit `8d46baa` (pre-existing, NOT caused by you):**
- `pnpm exec tsc --noEmit` → **2 errors**, both `src/components/landing/landing-page.test.tsx` ("Unused '@ts-expect-error' directive"). Your change must not add others.
- `pnpm lint` → **27 problems (12 errors, 15 warnings)**, none in this plan's in-scope files. Your change must not add any in the files you touch.

## Scope

**In scope** (modify):
- `src/lib/utils.ts` (add `formatNumber`; pin `formatDate` locale)
- `src/lib/utils.test.ts` (add tests)
- `src/components/info-drawer/format-time.ts` (add year)
- `src/components/info-drawer/format-time.test.ts` (create)
- `src/components/buckets/overview-activity-card.tsx` (add `title` tooltip — see Step 5)
- `src/components/shares/share-list-table.tsx`, `src/components/shares/share-dialog.tsx`, `src/components/buckets/multipart-uploads-tab.tsx` (date call sites)
- `src/components/connections/search-index-status.tsx`, `src/components/connections/connection-indexing-card.tsx`, `src/components/buckets/overview-storage-stats-card.tsx`, `src/components/billing/billing-tab.tsx` (number call sites)
- `src/app/app/settings/page.tsx` (route through helper)

**Out of scope** (do NOT touch):
- ISO `.toISOString()` tooltips/slices listed above — already locale-independent.
- `new Date(...)` calls used for arithmetic/sorting/persistence (e.g. `multipart-helpers.ts`, store/API files, `*.test.ts` fixtures) — not display formatting.
- `src/components/command-palette/*` — has unrelated uncommitted changes and its date output is already ISO. (Covered by plan 016, separately.)
- Any change that adds an i18n library or a user-facing locale setting — out of scope here (a locale preference is a separate, larger feature).

## Git workflow

- Branch: `advisor/012-standardize-formatting`
- Conventional-commit messages (repo style, e.g. `fix(format): pin date/number formatting to en-US`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `formatNumber` and pin `formatDate` in `src/lib/utils.ts`

Change `formatDate` to pass a fixed locale and add a `formatNumber` helper:

```ts
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
```

**Verify**: `pnpm exec tsc --noEmit` → no new errors beyond the 2 baseline.

### Step 2: Add the year to `formatRelativeTime`

In `src/components/info-drawer/format-time.ts`, change the final fallback (line 14) so dates include the year:

```ts
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
```

Keep the relative branches ("just now", "Nm ago", "Nh ago") unchanged.

**Verify**: `pnpm exec tsc --noEmit` → no new errors.

### Step 3: Replace bare date call sites with the shared `formatDate`

In each of these three files, import `formatDate` from `@/lib/utils` (the file may already import other helpers from there — add to the existing import) and replace the bare `new Date(x).toLocaleDateString()`:

- `src/components/shares/share-list-table.tsx:71` →
  `{s.expiresAt ? formatDate(s.expiresAt) : "Never"}`
- `src/components/shares/share-dialog.tsx:111` →
  `expires {formatDate(s.expiresAt)}`
- `src/components/buckets/multipart-uploads-tab.tsx:214` →
  `<div>{formatDate(u.initiated)}</div>`

`formatDate` accepts `Date | string`; `s.expiresAt`/`u.initiated` are ISO strings — pass them directly (do not wrap in `new Date`).

**Verify**: `pnpm exec tsc --noEmit` → no new errors. Then
`grep -rn "toLocaleDateString()" src/components/shares src/components/buckets/multipart-uploads-tab.tsx` → **no matches**.

### Step 4: Replace number call sites with `formatNumber`

Import `formatNumber` from `@/lib/utils` and replace each `.toLocaleString()` on a number:

- `src/components/connections/search-index-status.tsx:13,15,18` — `${data.indexed.toLocaleString()}` → `${formatNumber(data.indexed)}` (three occurrences).
- `src/components/connections/connection-indexing-card.tsx:113,135` — `{data.indexed.toLocaleString()}` → `{formatNumber(data.indexed)}`.
- `src/components/buckets/overview-storage-stats-card.tsx:76,104` — `.toLocaleString()` → `formatNumber(...)` (wrap the value).
- `src/components/billing/billing-tab.tsx:129` — `formatValue={(n) => n.toLocaleString()}` → `formatValue={formatNumber}`.

**Verify**: `pnpm exec tsc --noEmit` → no new errors. Then
`grep -rn "\.toLocaleString()" src/components/connections src/components/buckets/overview-storage-stats-card.tsx src/components/billing` → **no matches**.

### Step 5: Add a full-timestamp tooltip to the overview activity card

`src/components/buckets/overview-activity-card.tsx:88` renders `{formatRelativeTime(event.createdAt)}` with no tooltip. Wrap the displayed time in an element carrying a `title` with the full ISO timestamp, matching the pattern already used in `src/components/info-drawer/activity-tab.tsx:98` (`title={new Date(event.createdAt).toISOString()}`). Concretely, change the element that renders the relative time to include `title={new Date(event.createdAt).toISOString()}`. If line 88 is already inside an element with a `title`, leave it.

**Verify**: `grep -n "title=" src/components/buckets/overview-activity-card.tsx` → at least one match on the activity-time element; `pnpm exec tsc --noEmit` → no new errors.

### Step 6: Route the settings "member since" through the helper (consistency)

`src/app/app/settings/page.tsx:27` currently builds its own `"en-US"` date. Leave the **format** ("June 2026") but, if it's trivial, keep it as-is — this is a server component and already locale-fixed, so it is **not** a hydration risk. Only change it if you can do so without altering the rendered string. If unsure, **skip this step** (it's cosmetic) and note it as skipped.

**Verify**: page still compiles — `pnpm exec tsc --noEmit` → no new errors.

### Step 7: (Hydration confirmation) — see Test plan & STOP conditions

There is no automated test for the hydration overlay. After the above, the locale divergence that most plausibly caused it is gone. Confirm manually if a dev server is available (see Done criteria); if you cannot run the app, state that the hydration fix is *expected but unverified* in your status note.

## Test plan

- **`src/lib/utils.test.ts`** (extend): add a `describe("formatNumber")` with `expect(formatNumber(1234567)).toBe("1,234,567")` and `expect(formatNumber(0)).toBe("0")`. Add a `describe("formatDate")` asserting a fixed input yields a stable `"en-US"` string, e.g. `expect(formatDate("2026-06-05T14:30:00.000Z")).toContain("2026")` and `.toContain("Jun")` (avoid asserting the exact hour to stay timezone-robust).
- **`src/components/info-drawer/format-time.test.ts`** (create): model structure after `src/lib/utils.test.ts`. Cover: `formatRelativeTime` of a timestamp ~30s ago → `"just now"`; ~5 min ago → `"5m ago"`; an old fixed date (e.g. `"2024-01-15T00:00:00.000Z"`) → a string that `.toContain("2024")` (proves the year is present). Use `vi.setSystemTime` or compute the input relative to `Date.now()` for the relative branches.
- Verification: `pnpm test` → all pass, including the new tests.

## Done criteria

ALL must hold:

- [ ] `pnpm test` exits 0; new `formatNumber`/`formatRelativeTime` tests exist and pass
- [ ] `pnpm exec tsc --noEmit` shows **only** the 2 pre-existing `landing-page.test.tsx` errors
- [ ] `pnpm lint` introduces **no new** problems in the files this plan touched (compare against the 27-problem baseline; none of those 27 are in-scope files)
- [ ] `grep -rn "toLocaleDateString(undefined" src/` → no matches
- [ ] `grep -rn "\.toLocaleString()" src/components/connections src/components/billing src/components/buckets/overview-storage-stats-card.tsx` → no matches
- [ ] (If a dev server is available) loading `/app/connections` shows **no** "Hydration failed" recoverable-error overlay in the browser console
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (drift since `8d46baa`).
- After pinning all listed call sites to `"en-US"`, the `/app/connections` hydration overlay **persists** — that means the mismatch has a different root cause (e.g. a browser extension mutating `class`, a theme class applied only on the client, or `Date.now()`-derived output rendered during SSR). Do **not** start refactoring unrelated components; report what you observe (the exact element from the React error overlay's diff) so the cause can be re-scoped.
- A step's verification fails twice after a reasonable fix attempt.
- You find a user-facing date/number call site not listed here; add it to the same pattern only if it's clearly display formatting, otherwise report it.

## Maintenance notes

- New user-facing dates/numbers should call `formatDate`/`formatNumber` from `@/lib/utils`, never `toLocale*` with a runtime locale, to keep SSR/client output identical.
- A future "locale/date-format preference" feature (report finding #13) would replace the hardcoded `"en-US"` with a user setting threaded into these two helpers — they are the single choke point by design.
- Reviewer should scrutinize that no `toLocaleString()`/`toLocaleDateString(undefined)` remains in client components rendered during SSR, and that the new tests don't assert timezone-dependent substrings.
