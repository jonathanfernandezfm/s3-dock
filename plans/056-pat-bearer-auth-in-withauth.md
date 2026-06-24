# Plan 056: Add PAT Bearer token auth path to `withAuth`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 04e4c30..HEAD -- src/lib/auth/protect.ts src/lib/auth/mcp-token.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (modifies the auth gateway for all API routes)
- **Depends on**: none (plan 051 — PAT resolver — is already on main)
- **Category**: security / dx
- **Planned at**: commit `04e4c30`, 2026-06-24

## Why this matters

Every API route today authenticates exclusively via a Clerk session cookie
(`withAuth` calls `auth()` from `@clerk/nextjs/server`). This makes S3Dock's
API inaccessible to non-browser clients (MCP servers, CLIs, CI pipelines) that
cannot present a cookie. Plan 051 already added `resolveMcpToken` which maps a
`s3dock_pat_…` Bearer token to the same `AuthUser` shape Clerk produces. This
plan wires that resolver into `withAuth` as an **additive fast-path**: if the
request carries `Authorization: Bearer s3dock_pat_…`, the Clerk path is skipped
entirely and the PAT path resolves the user instead. No route needs to change.
Plan 054 (the HTTP-proxy MCP server) depends on this landing first.

## Current state

- **`src/lib/auth/protect.ts`** — the `withAuth` wrapper used by all API
  routes. Current shape (full file as of `04e4c30`):

  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { auth, currentUser } from "@clerk/nextjs/server";
  import prisma from "@/lib/db/prisma";
  import type { AuthUser } from "./clerk";

  type RouteContext = { params?: Promise<Record<string, string>> };
  type ProtectedHandler<T extends RouteContext = RouteContext> = (
    req: NextRequest,
    context: { user: AuthUser; params: ... }
  ) => Promise<NextResponse>;

  export function withAuth<T extends RouteContext = RouteContext>(
    handler: ProtectedHandler<T>
  ) {
    return async (req: NextRequest, context?: T) => {
      try {
        const { userId } = await auth();       // ← Clerk session path
        if (!userId) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        // ... prisma.user.findUnique / upsert ...
        return handler(req, { user, params });
      } catch (error) { ... }
    };
  }
  ```

- **`src/lib/auth/mcp-token.ts`** — already exists (plan 051). Exports
  `resolveMcpToken(rawToken: string): Promise<AuthUser | null>` and
  `TOKEN_PREFIX = "s3dock_pat_"`. Re-exported from `src/lib/auth/index.ts:4`.

- **Test convention** — `src/lib/auth/mcp-token.test.ts` and
  `src/lib/auth/require-connection-access.test.ts` show the project's vitest
  pattern: `vi.mock(...)` before imports, `vi.fn()` for mocks,
  `beforeEach(() => vi.clearAllMocks())`. Use the same style.

## Commands you will need

| Purpose     | Command                           | Expected on success |
|-------------|-----------------------------------|---------------------|
| Typecheck   | `pnpm typecheck`                  | exit 0, no errors   |
| Tests (new) | `pnpm test -- protect`            | all pass            |
| Tests (all) | `pnpm test`                       | all pass            |
| Lint        | `pnpm lint`                       | exit 0              |

## Scope

**In scope** (only these files):
- `src/lib/auth/protect.ts` (add Bearer fast-path before the Clerk block)
- `src/lib/auth/protect.test.ts` (create)

**Out of scope** (do NOT touch):
- Any API route file — zero route changes are needed.
- `src/lib/auth/mcp-token.ts` — already correct; do not modify.
- `src/lib/auth/clerk.ts` — do not touch.
- `src/middleware.ts` — if it exists, do not touch; this plan is about the
  per-route `withAuth` wrapper, not edge middleware.

## Git workflow

- Branch: `advisor/056-pat-bearer-auth`
- Conventional commits: `feat: add PAT Bearer token path to withAuth`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the Bearer fast-path to `protect.ts`

Open `src/lib/auth/protect.ts`. Add one import at the top:

```ts
import { resolveMcpToken, TOKEN_PREFIX } from "./mcp-token";
```

Inside `withAuth`'s returned function, **before** the `const { userId } = await auth()` line, insert the PAT fast-path:

```ts
// PAT Bearer token fast-path — bypasses Clerk for non-browser clients.
const authHeader = req.headers.get("authorization");
if (authHeader?.startsWith("Bearer ")) {
  const raw = authHeader.slice(7);
  if (raw.startsWith(TOKEN_PREFIX)) {
    const patUser = await resolveMcpToken(raw);
    if (!patUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const params = context?.params ? await context.params : {};
    return handler(req, {
      user: patUser,
      params: params as T["params"] extends Promise<infer P> ? P : Record<string, string>,
    });
  }
}
// Existing Clerk session path (unchanged below this line)
const { userId } = await auth();
```

The `TOKEN_PREFIX` guard (`raw.startsWith(TOKEN_PREFIX)`) ensures only `s3dock_pat_…` tokens are routed through the PAT path. A `Bearer` header with a non-PAT value (e.g. a JWT) falls through to the Clerk path unchanged.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Write tests

Create `src/lib/auth/protect.test.ts`. Model structure after
`src/lib/auth/mcp-token.test.ts` (vi.mock hoisting, vi.fn, beforeEach clear).

Mocks required:
- `vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }))`
- `vi.mock("@/lib/db/prisma", () => ({ default: { user: { findUnique: vi.fn(), upsert: vi.fn() } } }))`
- `vi.mock("./mcp-token", () => ({ resolveMcpToken: vi.fn(), TOKEN_PREFIX: "s3dock_pat_" }))`

Test cases to cover:

1. **No auth header, valid Clerk session** — `auth()` returns `{ userId: "clerk_u1" }`,
   `prisma.user.findUnique` returns a user → handler called with that user, returns 200.

2. **No auth header, no Clerk session** — `auth()` returns `{ userId: null }` →
   response is 401.

3. **Bearer PAT, valid token** — header is `Authorization: Bearer s3dock_pat_abc`,
   `resolveMcpToken` returns a user → handler called with that user, returns 200.
   Assert `auth()` was **not** called (Clerk bypassed).

4. **Bearer PAT, invalid token** — header is `Authorization: Bearer s3dock_pat_bad`,
   `resolveMcpToken` returns `null` → response is 401.
   Assert `auth()` was **not** called.

5. **Bearer with non-PAT value** — header is `Authorization: Bearer some-other-jwt`,
   → falls through to Clerk path (`auth()` is called).

Helper to build a minimal `NextRequest`:
```ts
function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/test", { headers });
}
```

**Verify**: `pnpm test -- protect` → 5 tests pass.

## Test plan

- New file `src/lib/auth/protect.test.ts`, 5 cases listed above.
- Pattern: `src/lib/auth/mcp-token.test.ts`.
- `pnpm test -- protect` → all 5 pass; `pnpm test` → full suite still passes.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test -- protect` → 5 tests pass
- [ ] `pnpm test` → all tests pass (no regressions)
- [ ] `grep -n "resolveMcpToken\|TOKEN_PREFIX" src/lib/auth/protect.ts` returns matches (import added)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 053 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `protect.ts` file at `04e4c30` doesn't match the "Current state" excerpt
  (it drifted — compare and report the diff before touching it).
- `resolveMcpToken` is not exported from `src/lib/auth/index.ts` (plan 051 not
  on main — this plan cannot proceed without it).
- The TypeScript type for `params` in the handler call causes a type error after
  the insertion — the type cast must match `protect.ts:85`'s existing pattern
  exactly. Report the mismatch rather than changing the type signature.
- Any verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Every API route inherits this change automatically** — no per-route work.
  Future routes that use `withAuth` get PAT auth for free.
- **Non-PAT Bearer tokens fall through to Clerk.** This is intentional and
  allows future JWT/OAuth Bearer support without changing this guard.
- **Reviewer focus**: confirm `auth()` is not called when the PAT path resolves
  successfully (test case 3 above covers this). An accidental Clerk call after
  PAT resolution would be a latency regression, not a security hole, but is
  still wrong.
- **Follow-up**: a UI and API route for managing (listing/revoking) PATs is
  explicitly deferred — see plan 051's maintenance notes.
