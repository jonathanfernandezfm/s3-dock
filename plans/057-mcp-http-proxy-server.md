# Plan 057: HTTP-proxy MCP server (replace in-process plan 052)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 04e4c30..HEAD -- package.json src/mcp/ .env.example`
> If `src/mcp/` already exists on the current branch (meaning PR #60 was
> merged), treat that as a STOP condition and report — do not overwrite it
> without review.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (new files only; no existing code modified beyond package.json)
- **Depends on**: **plans/053** (Bearer token auth in `withAuth` must land first)
- **Category**: direction / dx
- **Planned at**: commit `04e4c30`, 2026-06-24

## Why this matters

**This plan supersedes plan 052** (the in-process MCP server in PR #60). Plan
052's approach embedded S3Dock's database and encryption layer directly into the
MCP process — requiring `DATABASE_URL` and `ENCRYPTION_KEY` on the machine
running Claude Desktop or any other MCP client. That makes S3Dock a local
library, not a service.

The correct architecture for a hosted service is: S3Dock runs centrally, and
MCP clients call its HTTP API. This plan builds a thin MCP server that:

1. Reads two env vars: `S3DOCK_URL` (the hosted S3Dock instance) and
   `S3DOCK_MCP_TOKEN` (a PAT minted once per user).
2. For each MCP tool call, makes an authenticated HTTP request to S3Dock's
   existing API routes using `Authorization: Bearer <token>` (enabled by
   plan 053).
3. Returns the JSON response as MCP tool content.

The MCP client needs no database connection, no encryption key, and no
knowledge of S3 credentials — those stay in S3Dock's database where they belong.

**Before executing this plan**: confirm PR #60 (plan 052, the in-process
server) has been **closed without merging**. If it has been merged, treat as a
STOP condition.

## Current state

- **`src/mcp/` does not exist on `main`** (`04e4c30`). This plan creates it
  from scratch.

- **`@modelcontextprotocol/sdk` is NOT installed** on main (plan 052's
  `package.json` changes were never merged). `tsx` is also absent. Both must be
  installed in Step 1.

- **API routes the MCP tools will call** (all `withAuth`-guarded, all accept
  `Authorization: Bearer s3dock_pat_…` after plan 053 lands):

  | Tool | Method | Route | Request body |
  |------|--------|-------|-------------|
  | `list_connections` | GET | `/api/connections` | — |
  | `list_buckets` | POST | `/api/buckets` | `{ connectionId }` |
  | `list_objects` | POST | `/api/objects` | `{ connectionId, bucket, prefix?, continuationToken? }` |
  | `head_object` | POST | `/api/objects/head` | `{ connectionId, bucket, key }` |
  | `presign_download` | POST | `/api/objects/download` | `{ connectionId, bucket, key }` |

  Response shapes (verified from route source at `04e4c30`):
  - `GET /api/connections` → `{ id, name, endpoint, region, accessKeyId, forcePathStyle, workspaceId, workspaceType, role, createdAt, updatedAt }[]`
  - `POST /api/buckets` → `{ name, creationDate }[]`
  - `POST /api/objects` → `{ objects: [{ key, isFolder, lastModified?, size?, etag?, storageClass? }], isTruncated, nextContinuationToken? }`
  - `POST /api/objects/head` → `{ contentType?, cacheControl?, contentDisposition?, contentEncoding?, contentLanguage?, metadata, storageClass, serverSideEncryption?, sseKmsKeyId?, size?, etag?, lastModified?, versionId?, restore? }`
  - `POST /api/objects/download` → `{ url }` (pre-signed URL, always 3600 s expiry)

- **MCP SDK API** — confirm after installing. The SDK (v1.x) exposes:
  - `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`
  - `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"`
  - `server.tool(name, description, zodParamsSchema, handler)` — 4-arg form

- **`zod`** is already a dev dependency. Do not add it.

- **Existing script convention** — `scripts/` contains plain CommonJS scripts.
  This server is TypeScript run by `tsx` (same as plan 052's intent), so it
  uses `@/` path aliases. The `"mcp"` script goes in `package.json`.

- **`.env.example`** currently contains (partial):
  ```
  DATABASE_URL=...
  ENCRYPTION_KEY=...
  INTERNAL_API_TOKEN=...
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
  CLERK_SECRET_KEY=...
  S3DOCK_MCP_TOKEN=   # ← added by plan 051
  ```

## Commands you will need

| Purpose              | Command                                     | Expected on success |
|----------------------|---------------------------------------------|---------------------|
| Install SDK          | `pnpm add @modelcontextprotocol/sdk`        | exit 0              |
| Install tsx          | `pnpm add -D tsx`                           | exit 0              |
| Typecheck            | `pnpm typecheck`                            | exit 0, no errors   |
| Lint                 | `pnpm lint`                                 | exit 0              |
| Tests                | `pnpm test -- mcp`                          | all pass            |
| Bad-token smoke test | `S3DOCK_URL=https://x.invalid S3DOCK_MCP_TOKEN=bad pnpm mcp` | exits non-zero, prints auth error to stderr |

## Scope

**In scope** (create/modify only these):
- `src/mcp/server.ts` (create)
- `src/mcp/tools.test.ts` (create)
- `package.json` (add deps + `"mcp"` script)
- `pnpm-lock.yaml` (updated by pnpm automatically)
- `.env.example` (add `S3DOCK_URL=` entry)
- `docs/mcp.md` (create or overwrite if plan 052 created it)

**Out of scope** (do NOT touch):
- Any `src/app/**`, `src/lib/**`, or `src/components/**` — the web app is untouched.
- `src/lib/auth/protect.ts` — already modified by plan 053; do not re-touch.
- Mutating S3 tools (upload, delete, copy, move) — read-only MVP only.
- A remote/HTTP MCP transport — stdio only.

## Git workflow

- Branch: `advisor/057-mcp-http-proxy`
- Conventional commit: `feat: add HTTP-proxy MCP server for S3Dock`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Install dependencies and add the `mcp` script

```bash
pnpm add @modelcontextprotocol/sdk
pnpm add -D tsx
```

In `package.json` `"scripts"`, add:
```json
"mcp": "tsx src/mcp/server.ts"
```

After installing, verify the SDK API by reading
`node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js` or its
TypeScript declaration file — confirm `McpServer`, `tool()`, and
`StdioServerTransport` names before using them.

**Verify**: `node -e "require.resolve('@modelcontextprotocol/sdk/server/mcp.js')"` → exit 0.

### Step 2: Create `src/mcp/server.ts`

This is the single entrypoint: it reads env vars, verifies auth, registers
tools, and connects the stdio transport. Keep everything in one file — the
tools are tiny HTTP calls, no need for a separate `tools.ts`.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config — validated at startup
// ---------------------------------------------------------------------------

const BASE_URL = process.env.S3DOCK_URL?.replace(/\/$/, "");
const TOKEN = process.env.S3DOCK_MCP_TOKEN;

if (!BASE_URL || !TOKEN) {
  console.error("[s3dock-mcp] S3DOCK_URL and S3DOCK_MCP_TOKEN must be set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Authenticated fetch helper
// All S3Dock API calls go through here. Throws on non-2xx.
// stdout is the MCP protocol channel — never write to it outside the SDK.
// ---------------------------------------------------------------------------

async function sdFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`S3Dock API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Startup auth check — verifies the token works before accepting tool calls
// ---------------------------------------------------------------------------

async function verifyToken(): Promise<void> {
  try {
    await sdFetch("/api/connections");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 401/403 → token bad; other errors → network/url wrong
    throw new Error(`Startup auth check failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function main() {
  await verifyToken(); // exits via catch below if bad

  const server = new McpServer({ name: "s3dock", version: "0.2.0" });

  server.tool(
    "list_connections",
    "List the S3 connections this user can access (id, name, endpoint, region, role).",
    {},
    async () => {
      const data = await sdFetch("/api/connections");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "list_buckets",
    "List all buckets for a given S3 connection.",
    { connectionId: z.string().describe("The S3 connection ID") },
    async ({ connectionId }) => {
      const data = await sdFetch("/api/buckets", {
        method: "POST",
        body: JSON.stringify({ connectionId }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "list_objects",
    "List objects and folders under a prefix in a bucket. Supports pagination.",
    {
      connectionId: z.string().describe("The S3 connection ID"),
      bucket: z.string().describe("Bucket name"),
      prefix: z.string().optional().describe('Key prefix (e.g. "logs/"). Omit for root.'),
      continuationToken: z.string().optional().describe("Pagination token from a previous response"),
    },
    async (args) => {
      const data = await sdFetch("/api/objects", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "head_object",
    "Get metadata for an S3 object (content type, size, ETag, last modified, storage class, user metadata).",
    {
      connectionId: z.string().describe("The S3 connection ID"),
      bucket: z.string().describe("Bucket name"),
      key: z.string().describe("Object key"),
    },
    async (args) => {
      const data = await sdFetch("/api/objects/head", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "presign_download",
    "Generate a pre-signed download URL for an S3 object (valid for 1 hour).",
    {
      connectionId: z.string().describe("The S3 connection ID"),
      bucket: z.string().describe("Bucket name"),
      key: z.string().describe("Object key"),
    },
    async (args) => {
      const data = await sdFetch("/api/objects/download", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  // stdout belongs to the MCP protocol — always use stderr for diagnostics.
  console.error(`[s3dock-mcp] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

**Critical**: every `console.log` or `process.stdout.write` that is NOT the
SDK protocol output will corrupt the stdio channel. All diagnostics go to
`console.error`.

**Verify**:
1. `pnpm typecheck` → exit 0
2. `S3DOCK_URL=https://x.invalid S3DOCK_MCP_TOKEN=bad pnpm mcp` → exits
   non-zero, prints `Startup auth check failed` to stderr (proves env
   validation + that `tsx` resolves `@/` paths and the `@modelcontextprotocol`
   import chain without a crash)

### Step 3: Write tests (`src/mcp/tools.test.ts`)

Since tools are defined inline in `server.ts`, test the `sdFetch` integration
pattern by testing `server.ts`'s exported (or extractable) logic indirectly, OR
extract the tool callback functions into `src/mcp/tools.ts` (a tiny module) and
test those directly. Choose whichever is cleaner given the actual code shape.

The key cases to cover — mock `fetch` globally (`vi.stubGlobal("fetch", vi.fn())`):

1. **`list_connections` success** — `fetch` returns `[{ id: "c1", name: "Prod" }]`
   (200) → tool returns JSON string containing `"c1"`.

2. **API error propagation** — `fetch` returns a 404 response → `sdFetch`
   throws an error containing `"404"`. Tool surfaces the error.

3. **`list_objects` passes all params** — `fetch` is called with the correct
   URL (`/api/objects`), method POST, and body including `continuationToken`.

4. **`presign_download` returns `{ url }`** — `fetch` returns `{ url: "https://..." }`
   → tool content contains the URL string.

5. **Missing env vars** — if `S3DOCK_URL` or `S3DOCK_MCP_TOKEN` is unset, the
   process would have exited before reaching tools. Cover the `sdFetch` error
   path (non-2xx) instead, since env guard is a startup concern.

Model the test file structure after `src/lib/auth/mcp-token.test.ts`: import
order, `vi.mock`/`vi.stubGlobal` before imports, `beforeEach(() => vi.clearAllMocks())`.

**Verify**: `pnpm test -- mcp` → all pass (≥5 assertions).

### Step 4: Update docs and `.env.example`

Add `S3DOCK_URL=` to `.env.example` (before `S3DOCK_MCP_TOKEN`, with a comment):
```
# MCP server: the URL of your hosted S3Dock instance
S3DOCK_URL=https://your-s3dock.example.com
# MCP server: personal access token (mint with node scripts/issue-mcp-token.js)
S3DOCK_MCP_TOKEN=
```

Create (or overwrite) `docs/mcp.md` with:

```markdown
# S3Dock MCP Server

The S3Dock MCP server lets AI assistants (Claude Desktop, etc.) access your
S3 connections through a hosted S3Dock instance. It exposes five read-only
tools: `list_connections`, `list_buckets`, `list_objects`, `head_object`,
and `presign_download`.

## Setup

### 1. Mint a personal access token

On the machine running S3Dock (with `DATABASE_URL` set):

    node scripts/issue-mcp-token.js <your-email> <token-name>

Copy the printed `s3dock_pat_…` token — it is shown once.

### 2. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent path on Windows/Linux:

    {
      "mcpServers": {
        "s3dock": {
          "command": "pnpm",
          "args": ["mcp"],
          "cwd": "/absolute/path/to/this/repo",
          "env": {
            "S3DOCK_URL": "https://your-s3dock.example.com",
            "S3DOCK_MCP_TOKEN": "s3dock_pat_..."
          }
        }
      }
    }

### 3. Verify

In Claude Desktop, try: *"List my S3 connections"*.

## Available tools

| Tool | Description |
|------|-------------|
| `list_connections` | List S3 connections you can access |
| `list_buckets` | List buckets for a connection |
| `list_objects` | List objects/folders under a prefix (paginated) |
| `head_object` | Get metadata for an object |
| `presign_download` | Generate a 1-hour download URL |

## Quota

Each S3 tool call counts as one operation against your S3Dock monthly quota
(same as web app usage). `list_connections` is free (no S3 call).

## Revoke a token

Delete the row from the `mcp_tokens` table:
`DELETE FROM mcp_tokens WHERE prefix = 's3dock_pat_' AND name = '<token-name>';`
A token revoke UI is planned as a follow-up.
```

**Verify**: `grep -n "S3DOCK_URL\|S3DOCK_MCP_TOKEN" .env.example docs/mcp.md` → matches in both files.

## Test plan

- `src/mcp/tools.test.ts`, 5 cases as described in Step 3.
- Mock `fetch` with `vi.stubGlobal`; no real HTTP calls in tests.
- `pnpm test -- mcp` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test -- mcp` → all pass (≥5 assertions in `tools.test.ts`)
- [ ] `S3DOCK_URL=https://x.invalid S3DOCK_MCP_TOKEN=bad pnpm mcp` → exits non-zero, `Startup auth check failed` on stderr
- [ ] `grep -rn "console.log" src/mcp/` → no matches
- [ ] `package.json` has `"mcp": "tsx src/mcp/server.ts"` script
- [ ] `@modelcontextprotocol/sdk` appears in `package.json` dependencies
- [ ] `grep -n "S3DOCK_URL" .env.example docs/mcp.md` → matches in both
- [ ] No files under `src/app/` or `src/lib/` were modified (`git status`)
- [ ] `plans/README.md` status row for 054 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `src/mcp/` already exists on the current branch — PR #60 may have been
  merged. Do not overwrite; report and wait.
- `@modelcontextprotocol/sdk` installs but `McpServer`/`tool()`/`StdioServerTransport`
  don't exist — the SDK API changed materially. Read the installed package and
  report the actual API shape.
- `pnpm typecheck` fails because `tsx` can't resolve `@/lib/...` imports in
  `src/mcp/server.ts` — the tsconfig path alias may not cover `src/mcp/`. Read
  `tsconfig.json` and report the include/paths configuration.
- Any verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Mutating tools deferred**: `upload_object`, `delete_object`, `copy`,
  `move`, `create_folder`. Each can call the corresponding existing API route
  (`POST /api/objects/delete`, etc.) with the same Bearer pattern — no
  `withAuth` changes needed. Gate these in the tool description ("requires
  EDITOR or ADMIN role") to match the underlying route's role check.
- **Hosted/remote transport**: for a shared MCP server (multiple users), switch
  to the SDK's HTTP+SSE or Streamable HTTP transport and resolve the PAT
  per-request from the `Authorization` header instead of once at startup. The
  server refactors to a stateless handler. `resolveMcpToken` (plan 051) is
  already the single chokepoint.
- **`presign_download` always returns 3600 s expiry** — this is the existing
  `/api/objects/download` route's behavior. A configurable `expiresIn` would
  require a new or modified API route; deferred.
- **Reviewer focus**: (1) nothing writes to stdout outside the SDK; (2)
  `sdFetch` never logs the `Authorization` header value in errors; (3) the
  startup `verifyToken()` call prevents a process from sitting alive with a
  bad token.
