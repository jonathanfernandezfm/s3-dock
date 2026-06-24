# Plan 055: Disable PostHog analytics in local/dev environments

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 04e4c30..HEAD -- src/lib/analytics.ts src/components/providers/posthog-provider.tsx .env.example`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `04e4c30`, 2026-06-24

## Why this matters

PostHog analytics is fully wired up and a **real project key is configured in
the shared `.env`** (region: PostHog EU cloud). Today the only condition for
sending events is "is the key set?" (`posthog-provider.tsx:11`). That means any
developer running `pnpm dev` with the team `.env` ships **local development
traffic — pageviews, page-leaves, Clerk-identified users, and the 8 domain
events — straight into the production PostHog project**, polluting funnels,
session counts, and user records with dev noise (and developers' own
identified sessions). This plan makes analytics **off by default unless the app
is running as a production build**, with an explicit opt-in flag for the rare
case where a developer wants to verify analytics locally. After this lands,
`pnpm dev` and the test runner never emit events, regardless of whether the key
is present.

## Current state

Two files own all PostHog behavior; both are client-only modules.

- `src/components/providers/posthog-provider.tsx` — initializes the SDK and
  drives pageview + user-identify. Current init guard (lines 9–18):

```ts
let posthogInitialized = false;
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (posthogKey && !posthogInitialized) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    capture_pageview: false,
    capture_pageleave: true,
  });
  posthogInitialized = true;
}
```

  The pageview effect (lines 20–34) calls `ph.capture("$pageview", …)` and the
  identify effect (lines 36–52) calls `ph.identify(user.id, …)` / `ph.reset()`.

- `src/lib/analytics.ts` — the typed event helper used by all 8 domain call
  sites. Current full file:

```ts
import posthog from "posthog-js";

export type TrackableEvent =
  | { name: "connection_created"; props: { workspace_type: "PERSONAL" | "TEAM" } }
  | { name: "connection_deleted" }
  | { name: "files_deleted"; props: { count: number } }
  | { name: "folder_created" }
  | { name: "files_copied"; props: { count: number; cross_connection: boolean } }
  | { name: "files_moved"; props: { count: number; cross_connection: boolean } }
  | { name: "share_link_created" }
  | { name: "checkout_initiated" };

export function track(event: TrackableEvent) {
  if (typeof window === "undefined") return;
  try {
    posthog.capture(event.name, "props" in event ? event.props : {});
  } catch {
    // analytics must never break application flow
  }
}
```

- `.env.example:67-68` documents the two public vars:

```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

**Key facts the executor needs:**

- These are `NEXT_PUBLIC_*` vars, inlined into the **client** bundle at build
  time. `process.env.NODE_ENV` is likewise inlined by Next.js in client code
  and resolves to `"development"` under `next dev` (`pnpm dev`), `"production"`
  under `next build` / `next start` (`pnpm build` / `pnpm start`, see
  `package.json:6-8`), and `"test"` under Vitest.
- The repo already has a **pure-function-over-env, tested separately**
  convention. See `src/lib/env.ts` (`validateEnv(env)`) and its test
  `src/lib/env.test.ts`. Match that shape: a pure function that takes an `env`
  object so it can be unit-tested without mutating `process.env`. There is even
  an existing test asserting the PostHog key is optional
  (`env.test.ts:73-77`) — do not remove it.
- All client-side captures flow through exactly two places: the provider
  (init + pageview + identify) and `track()`. Gating both is sufficient; there
  are no other `posthog.*` or `.capture(` call sites (the 8 domain call sites
  all go through `track()`).

## Commands you will need

| Purpose   | Command          | Expected on success |
|-----------|------------------|---------------------|
| Install   | `pnpm install`   | exit 0              |
| Tests     | `pnpm test`      | all pass, exit 0    |
| Typecheck | `pnpm typecheck` | exit 0, no errors   |
| Lint      | `pnpm lint`      | exit 0              |

The active verification gate for this repo is
`pnpm test && pnpm typecheck && pnpm lint` → exit 0.

## Scope

**In scope** (the only files you should modify or create):
- `src/lib/analytics.ts` (modify)
- `src/lib/analytics.test.ts` (create)
- `src/components/providers/posthog-provider.tsx` (modify)
- `.env.example` (modify — doc comment only)
- `plans/README.md` (status row update, last step)

**Out of scope** (do NOT touch, even though they look related):
- The 8 domain call sites (`src/lib/queries/connections.ts`,
  `src/lib/queries/objects.ts`, `src/lib/queries/share-links.ts`,
  `src/components/billing/plans-modal.tsx`). They call `track()` and need no
  change — gating happens inside `track()`.
- `src/lib/env.ts` / its `REQUIRED` list — analytics is intentionally optional;
  do not add any PostHog var to required-env validation.
- The real `.env` file — never read, edit, or print its values.

## Git workflow

- Branch: `advisor/055-disable-posthog-local-dev`
- Commit style is conventional commits (see `git log --oneline`: `feat:`,
  `fix:`). Use e.g. `feat: disable PostHog analytics outside production builds`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a tested `isAnalyticsEnabled` predicate + gate `track()`

Edit `src/lib/analytics.ts`. Add a pure predicate and a module-level constant
derived from `process.env`, then short-circuit `track()` when disabled. Target
shape:

```ts
import posthog from "posthog-js";

/**
 * Analytics is enabled only for production builds — so local `next dev` and the
 * Vitest runner never send events to the shared PostHog project — and only when
 * a project key is configured. Set NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=true to opt
 * a local/dev session in for verification.
 */
export function isAnalyticsEnabled(env: {
  NEXT_PUBLIC_POSTHOG_KEY?: string;
  NODE_ENV?: string;
  NEXT_PUBLIC_POSTHOG_FORCE_ENABLE?: string;
}): boolean {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return false;
  if (env.NEXT_PUBLIC_POSTHOG_FORCE_ENABLE === "true") return true;
  return env.NODE_ENV === "production";
}

export const analyticsEnabled = isAnalyticsEnabled(process.env);

export type TrackableEvent =
  /* ...unchanged 8-variant union... */;

export function track(event: TrackableEvent) {
  if (typeof window === "undefined") return;
  if (!analyticsEnabled) return;
  try {
    posthog.capture(event.name, "props" in event ? event.props : {});
  } catch {
    // analytics must never break application flow
  }
}
```

Keep the `TrackableEvent` union exactly as-is. Only add the predicate/constant
and the `if (!analyticsEnabled) return;` guard.

**Verify**: `pnpm typecheck` → exit 0, no errors.

### Step 2: Unit-test the predicate

Create `src/lib/analytics.test.ts`, modeled structurally on
`src/lib/env.test.ts` (pure function fed an `env` object; Vitest
`describe`/`it`/`expect`). Cover:

- returns `false` when `NEXT_PUBLIC_POSTHOG_KEY` is unset (key present:
  `NODE_ENV: "production"`).
- returns `false` in development even when the key is set
  (`{ NEXT_PUBLIC_POSTHOG_KEY: "phc_x", NODE_ENV: "development" }`).
- returns `false` under test env (`NODE_ENV: "test"`) with the key set.
- returns `true` in production with the key set.
- returns `true` when `NEXT_PUBLIC_POSTHOG_FORCE_ENABLE: "true"` even in
  development (key set) — the opt-in override.
- returns `false` when the force flag is set but the key is **absent** (no key
  ⇒ never enabled, even forced).

Import only the named predicate: `import { isAnalyticsEnabled } from "./analytics";`.

**Verify**: `pnpm test` → all pass, including the new `analytics.test.ts` cases.

> Note: importing `./analytics` pulls in `posthog-js`. The existing test setup
> runs under jsdom (`jsdom` devDependency; `@testing-library/react` is
> configured) and `posthog-js` is side-effect-free on import (init is explicit).
> If the import nonetheless throws at collection time, that is a STOP condition —
> report it rather than refactoring the module to dodge it.

### Step 3: Gate the provider on `analyticsEnabled`

Edit `src/components/providers/posthog-provider.tsx`:

1. Import the constant: `import { analyticsEnabled } from "@/lib/analytics";`
2. Change the init guard to require it:

```ts
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (analyticsEnabled && posthogKey && !posthogInitialized) {
  posthog.init(posthogKey, { /* unchanged options */ });
  posthogInitialized = true;
}
```

3. Short-circuit both effects so they never call `capture`/`identify` when
   disabled. Add as the first line inside each `useEffect` body:

   - In `PostHogPageView`'s effect (currently line 25): `if (!analyticsEnabled) return;`
   - In `PostHogUserIdentify`'s effect (currently line 40): `if (!analyticsEnabled) return;`

Do not otherwise change the provider's structure, the `Suspense` boundary, or
the init options.

**Verify**: `pnpm typecheck` → exit 0; `pnpm lint` → exit 0.

### Step 4: Document the behavior in `.env.example`

Edit `.env.example` around lines 67–68. Add a comment above the two PostHog
lines and document the optional override. Target:

```
# Analytics (PostHog). Optional — leave the key blank to disable entirely.
# Events are sent ONLY in production builds (next build/start). Local `pnpm dev`
# and tests never send events even with a key set. To verify analytics locally,
# set NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=true.
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
# NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=true
```

**Verify**: `pnpm lint` → exit 0 (no code change; confirms nothing else broke).

### Step 5: Update the plans index

In `plans/README.md`, add a row 055 to the status table and set its Status to
`DONE`. (See "Done criteria".)

## Test plan

- New file `src/lib/analytics.test.ts`, structured like `src/lib/env.test.ts`,
  with the six cases listed in Step 2 (no key; dev+key; test+key; prod+key;
  forced-in-dev; forced-without-key).
- No existing tests should change. `env.test.ts:73-77` (PostHog key optional)
  must still pass untouched.
- Verification: `pnpm test` → all pass, including the new cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0; `src/lib/analytics.test.ts` exists and its cases pass
- [ ] `pnpm lint` exits 0
- [ ] `git grep -n "analyticsEnabled" src/components/providers/posthog-provider.tsx` shows the init guard and both effect guards reference it (3+ matches)
- [ ] `git grep -n "if (!analyticsEnabled) return" src/lib/analytics.ts` returns 1 match (the `track()` guard)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 055 is present and set to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts (the
  files drifted since `04e4c30`).
- Importing `./analytics` in the new test throws at collection time (see Step 2
  note) — report rather than restructuring the analytics module.
- `process.env.NODE_ENV` is not being inlined as expected (e.g. analytics still
  fires under `pnpm dev` after the change) — this would mean a non-standard
  Next.js/env setup; report it.
- The change appears to require editing any out-of-scope file.

## Maintenance notes

For the human/agent who owns this after it lands:

- **Single source of truth**: `isAnalyticsEnabled` / `analyticsEnabled` in
  `src/lib/analytics.ts` is now the only gate. Any new PostHog capture path must
  also respect it. If you add a server-side analytics path later
  (`posthog-node`), give it its own server-env predicate — `NEXT_PUBLIC_*` and
  `process.env.NODE_ENV` inlining are client-bundle concepts.
- **Scope is "local dev", not "staging"**: gating on `NODE_ENV === "production"`
  means any deploy that runs a production build (`next start`) — including a
  staging/preview environment — still sends events. That is intentional for this
  plan (the request was to silence *local* dev). If you later want to exclude a
  staging deploy too, gate additionally on the deploy host or a dedicated env
  flag (e.g. only enable when `NEXT_PUBLIC_POSTHOG_HOST` matches the prod project
  and an explicit `APP_ENV=production` is set) — deliberately deferred here.
- **Reviewer focus**: confirm the provider's init guard AND both effects are
  gated (an ungated effect would still `identify`/`capture` against an
  uninitialized client; harmless today since capture no-ops pre-init, but it's
  defense-in-depth and keeps intent clear).
- The opt-in override is `NEXT_PUBLIC_POSTHOG_FORCE_ENABLE=true`. It's
  documented in `.env.example` and commented-out by default.
