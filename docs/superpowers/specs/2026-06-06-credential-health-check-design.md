# Credential Health Check Design

**Date:** 2026-06-06
**Status:** Approved
**Headline value:** Probe each S3 connection's credentials for the permissions the app actually needs, surface the results as a per-connection and per-bucket diagnostic, and gate UI actions on the cached result. Onboarding diagnostic, feature gating, and troubleshooting tool — one unified system, one source of truth.

---

## Goal

Build a permissions health check for every S3 connection so users can immediately see — at connection-level and per-bucket — which app capabilities will work, which won't, and exactly which IAM actions are missing. Cache the results in Postgres so the same check powers (a) an onboarding diagnostic that runs right after a connection is added, (b) a re-runnable troubleshooting report on dedicated pages, and (c) feature gating across the app (disabled buttons with tooltips, hidden sections).

Provider-agnostic: works with AWS, MinIO, R2, Wasabi, and other S3-compatible endpoints. No reliance on AWS-only IAM policy simulation. Probes use crafted no-op requests (nonexistent keys, intentionally-failing preconditions, idempotent reads) so the check itself leaves no artifacts in the buckets it inspects.

## Non-goals (v1)

- **No AWS-only shortcut.** We do not call `SimulatePrincipalPolicy` for AWS connections. Provider-agnostic probes are the single mechanism — keeps behavior identical across providers and avoids a code path that only AWS users exercise.
- **No bulk "check every bucket" action.** Per-bucket runs trigger lazily on first navigation. A workspace with 200 buckets does not fan out 200 checks at once. A future admin action can be added but is out of scope.
- **No scheduled background re-runs.** The user explicitly triggers refresh from the UI; staleness is communicated via a "X days old" badge.
- **No per-prefix scoping.** Some IAM policies scope to `bucket/prefix/*`. v1 treats permissions as bucket-wide. If a credential has access to one prefix but not another in the same bucket, the report may show "available" while specific operations still fail — surfaced by the API layer at use time.
- **No `CreateBucket` direct probe.** Cannot be tested without creating a bucket. Marked `untested` in the report; verified opportunistically the first time a user attempts it.
- **No metrics backend.** Server logs only. No counters, no dashboards.
- **No multi-instance lock coordination.** Per-process in-memory mutex serializes concurrent runs of the same scope. Sufficient for single-instance Next.js; multi-instance deploys would need a DB advisory lock — out of scope until needed.
- **No component-level tests for the new UI.** Matches the codebase's discipline (only server helpers, reducers, and pure logic are unit-tested). The rollup logic and probe interpretation are the testable surface.

---

## User-facing behavior

### Entry points

- **Auto-run on connection add.** `POST /api/connections` kicks off a non-blocking connection-level health check after the connection record is created. The new connection's page polls for the result.
- **Connection diagnostic page** at `/connections/[id]/health` — reached from a new "Health" link on each connection card.
- **Bucket Overview tab** — a new "Permissions" card sits alongside the existing Versioning / Storage Stats / Activity / Incomplete-Uploads cards. Lazy-runs the bucket-level check on first visit.
- **Full bucket report** at `/connections/[id]/buckets/[bucket]/health` — a focused view for users who want everything in one place. Linked from the Permissions card's "View full report".
- **Manual refresh** — every report surface has a "Refresh" button that re-runs the check for that scope.

### Capability model

A **capability** is a user-facing feature group. A **probe** is a single S3 operation we test to determine whether a capability is granted. Each capability has one or more required probes; status is rolled up from the probe results.

**Probe results:**

| Result | Meaning |
|---|---|
| `granted` | Auth succeeded; probe completed (or failed in a way that proves permission, e.g. 404 on a nonexistent key) |
| `denied` | Explicit 403/AccessDenied |
| `unsupported` | Provider returned `NotImplemented` |
| `error` | Network, timeout, or unexpected status — inconclusive |
| `skipped` | Probe was not applicable to this run (e.g. `put-bucket-versioning` on a never-versioned bucket where the no-op trick has no defined state to re-put). Ignored by rollup. |

**Capability statuses:**

| Status | Meaning |
|---|---|
| `available` | All required, non-skipped probes returned `granted` |
| `unavailable` | At least one required probe returned `denied` |
| `unsupported` | At least one required probe returned `unsupported`, none `denied` |
| `unknown` | At least one required probe returned `error`, none `denied`/`unsupported` |
| `untested` | Capability has no automatic probe (e.g. `Create buckets`), OR all required probes were `skipped` |

Rollup precedence: `denied > unsupported > error > granted`. Any `denied` makes the capability `unavailable` regardless of other probe outcomes. `skipped` probes are filtered out before precedence evaluation.

**Connection-level capabilities** (scope = the credentials, not tied to a bucket):

| Capability key | Display label | Required probes | IAM actions surfaced when unavailable |
|---|---|---|---|
| `browse-buckets` | Browse buckets | `list-buckets` | `s3:ListAllMyBuckets` |
| `create-buckets` | Create buckets | _(none — `untested`)_ | `s3:CreateBucket` |
| `delete-buckets` | Delete buckets | `delete-bucket` | `s3:DeleteBucket` |

**Per-bucket capabilities:**

| Capability key | Display label | Required probes | IAM actions surfaced when unavailable |
|---|---|---|---|
| `browse-objects` | Browse objects | `list-objects-v2` | `s3:ListBucket` |
| `download-objects` | Download objects | `head-object` | `s3:GetObject` |
| `upload-objects` | Upload objects | `put-object` | `s3:PutObject` |
| `delete-objects` | Delete objects | `delete-object` | `s3:DeleteObject` |
| `copy-objects` | Copy / Rename / Move | `copy-object` | `s3:GetObject`, `s3:PutObject` (and `s3:DeleteObject` for Move — surfaced as a sub-note) |
| `object-tagging` | Object tags | `get-object-tagging`, `put-object-tagging` | `s3:GetObjectTagging`, `s3:PutObjectTagging` |
| `list-versions` | List object versions | `list-object-versions` | `s3:ListBucketVersions` |
| `manage-versioning` | Manage bucket versioning | `get-bucket-versioning`, `put-bucket-versioning` | `s3:GetBucketVersioning`, `s3:PutBucketVersioning` |
| `view-multipart` | View incomplete uploads | `list-multipart-uploads` | `s3:ListBucketMultipartUploads` |

### Probe catalog and no-op techniques

Every probe targets a guaranteed-failing case. The probe runner inspects the response code / SDK error name to classify the result.

| Probe key | S3 command | Technique | Granted on | Denied on |
|---|---|---|---|---|
| `list-buckets` | `ListBucketsCommand` | Direct call — read-only | `200` | `AccessDenied` / `403` |
| `delete-bucket` | `DeleteBucketCommand` | Bucket name `s3client-healthcheck-${uuid}` (UUID-prefixed, guaranteed nonexistent) | `NoSuchBucket` / `404` | `AccessDenied` / `403` |
| `list-objects-v2` | `ListObjectsV2Command` | `MaxKeys: 1` on the target bucket | `200` | `AccessDenied` / `403` |
| `head-object` | `HeadObjectCommand` | Key `__s3client-healthcheck__/probe-${uuid}` (guaranteed nonexistent) | `NotFound` / `404` | `AccessDenied` / `403` |
| `put-object` | `PutObjectCommand` | Empty body, target key `__s3client-healthcheck__/probe-${uuid}`, `ContentMD5: "AAAAAAAAAAAAAAAAAAAAAA=="` (deliberately wrong base64 MD5 — does not match empty body). S3 evaluates auth before Content-MD5 validation across all providers | `BadDigest` / `InvalidDigest` / `400` | `AccessDenied` / `403` |
| `delete-object` | `DeleteObjectCommand` | Same nonexistent key. S3 DeleteObject is idempotent — succeeds even when key is absent | `200`/`204` | `AccessDenied` / `403` |
| `copy-object` | `CopyObjectCommand` | `CopySource: <bucket>/__s3client-healthcheck__/source-${uuid}`, `Key: __s3client-healthcheck__/dest-${uuid}` | `NoSuchKey` / `404` | `AccessDenied` / `403` |
| `get-object-tagging` | `GetObjectTaggingCommand` | Nonexistent key | `NoSuchKey` / `404` | `AccessDenied` / `403` |
| `put-object-tagging` | `PutObjectTaggingCommand` | Nonexistent key with an empty tag set | `NoSuchKey` / `404` | `AccessDenied` / `403` |
| `list-object-versions` | `ListObjectVersionsCommand` | `MaxKeys: 1` | `200` | `AccessDenied` / `403` |
| `get-bucket-versioning` | `GetBucketVersioningCommand` | Direct call — idempotent, returns empty for non-versioned buckets | `200` | `AccessDenied` / `403` |
| `put-bucket-versioning` | `PutBucketVersioningCommand` | Two-step: first read state via `get-bucket-versioning`. If the bucket has a defined `Status` (`Enabled` or `Suspended`), re-put that same status (idempotent no-op). If the bucket has never been versioned (`Status` is undefined), the probe returns `skipped` and the rollup ignores it (see "Skipped probes" below) | `200` | `AccessDenied` / `403` |
| `list-multipart-uploads` | `ListMultipartUploadsCommand` | `MaxUploads: 1` | `200` | `AccessDenied` / `403` |

**Provider-specific handling:** R2 returns `NotImplemented` for `ListObjectVersions` on non-versioning-aware accounts and for `PutBucketVersioning`. The probe runner treats `NotImplemented` as `unsupported` (capability rendered as "Not supported by this provider" — different UI from "Denied" so users don't think they need to add IAM permissions).

### Connection diagnostic page

`/connections/[id]/health`

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER                                                       │
│  ← Back · "Permissions" · last-checked timestamp · Refresh   │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ STALENESS BANNER (only when isStale)                        │
│  "Results are 12 days old. Refresh to verify."              │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ CONNECTIVITY ERROR (only when connectivity != "ok")         │
│  "Couldn't reach <endpoint>. Check the URL and credentials."│
│  [Re-test connection]                                       │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ CAPABILITY LIST                                             │
│  ✓ Browse buckets                                          ▾│
│  ⚠ Create buckets (untested)                               ▾│
│  ✗ Delete buckets                                          ▾│
│       Required IAM actions: s3:DeleteBucket  [Copy]         │
│       Affects: Bucket delete button (disabled)              │
│       Probe details: delete-bucket → denied (AccessDenied)  │
└─────────────────────────────────────────────────────────────┘
```

Each capability row collapses by default. Expanded state shows the underlying probe results, the required IAM actions list (with copy-to-clipboard), and a "What does this affect?" section listing the UI surfaces gated by this capability.

### Bucket Permissions card

Renders on the existing Bucket Overview tab as a new card. Compact summary view:

```
┌─────────────────────────────────────────┐
│ Permissions                  ⟳ Refresh  │
│ 7 of 9 available · 2 unavailable        │
│ Last checked 3 hours ago                │
│                                         │
│  ✓ Browse objects                       │
│  ✓ Download objects                     │
│  ✓ Upload objects                       │
│  ✗ Copy / Rename / Move                 │
│  ✓ Delete objects                       │
│  ✗ Object tags                          │
│  ✓ List versions                        │
│  ✓ Manage versioning                    │
│  ✓ View incomplete uploads              │
│                                         │
│  View full report →                     │
└─────────────────────────────────────────┘
```

The full-report link routes to `/connections/[id]/buckets/[bucket]/health`, which renders the same layout as the connection diagnostic page but for bucket-level capabilities.

### Initial-check states

- **No persisted record yet (auto-run not finished).** Skeleton with "Running initial permission check…" message. Page polls `GET` every 2s for up to 30s. On completion, swaps to the report. On polling timeout, shows "Couldn't complete check" + "Retry" button which fires `POST` and resumes polling.
- **Manual refresh in progress.** The previous report remains visible with a subtle "Refreshing…" overlay; on completion the report swaps without layout shift.
- **First-time bucket visit.** Same skeleton-and-poll pattern on the Permissions card only; the rest of the Overview renders independently (other cards do not block).

### Feature gating

A new hook `useCapability(connectionId, bucket?, capabilityKey)` returns `{ status, reason, isLoading }`. UI primitives consume it:

- **`<CapabilityGate capability="upload" connectionId={c} bucket={b}>...</CapabilityGate>`** renders children when status is `available`. Otherwise renders a `disabled` variant: button stays in the DOM, becomes `disabled`, gets a tooltip explaining the reason ("You don't have `s3:PutObject` on this bucket. See Permissions in Overview for details.") with a link to the bucket's health page.
- **Discoverability over silence.** All gated buttons remain visible-but-disabled. Hidden-by-default would make users think the feature doesn't exist.
- **Sections gated as a unit.** For multi-button panels (Versioning controls, Tags panel) where the entire feature is unusable, the panel renders a single disabled state with the same tooltip pattern, replacing all internal buttons.
- **Permissive default.** When the report is `isLoading` or missing, `useCapability` returns `status: "available"` so the user is not locked out before the first check completes. The API layer will return a real error if the action genuinely lacks permission — gating is a UX improvement, not a security boundary.

**Gating call-sites:**

| Capability | UI surfaces gated |
|---|---|
| `browse-buckets` | If denied, `/connections` page shows a top-of-page warning banner; bucket list is empty with "No access to list buckets" hint. (The action — the navigation itself — isn't blocked.) |
| `create-buckets` | "+ New bucket" button on `/buckets` (disabled-with-tooltip when status is `unavailable`; left active when `untested`) |
| `delete-buckets` | "Delete bucket" action in `bucket-detail` header + bucket card dropdown |
| `browse-objects` | File browser empty state shows "No access to list objects in this bucket" when denied |
| `upload-objects` | Upload button, drag-drop zone, "+ New folder" button |
| `download-objects` | Per-row download button, bulk download action |
| `copy-objects` | Rename / Copy / Move context-menu entries + bulk action buttons |
| `delete-objects` | Per-row delete button, bulk delete action |
| `object-tagging` | Tags panel in object detail (entire section disabled-with-tooltip) |
| `list-versions` | Versions tab/view (tab disabled when denied) |
| `manage-versioning` | Versioning card buttons on bucket Overview |
| `view-multipart` | Incomplete Uploads card on bucket Overview (entire card shows disabled state when denied) |

---

## Architecture

### File structure

**New files (created):**

| Path | Responsibility |
|---|---|
| `src/lib/health/capabilities.ts` | Capability constants: keys, display labels, required IAM actions, UI surfaces. Pure data. |
| `src/lib/health/probe.ts` | `Probe` interface, `ProbeResult` type, `ProbeContext` type |
| `src/lib/health/probes/connection.ts` | Connection-scoped probe definitions (`list-buckets`, `delete-bucket`) |
| `src/lib/health/probes/bucket.ts` | Bucket-scoped probe definitions (the remaining 12 probes) |
| `src/lib/health/registry.ts` | Exports `CONNECTION_PROBES` and `BUCKET_PROBES` arrays; `getProbesByCapability` helper |
| `src/lib/health/classify.ts` | Pure `classifyError(err: unknown) → ProbeResult` based on SDK error name / HTTP status. Unit-testable. |
| `src/lib/health/rollup.ts` | Pure `rollupCapabilities(probeResults) → Capability[]`. Unit-testable. |
| `src/lib/health/runner.ts` | `runConnectionHealthCheck(connectionId)`, `runBucketHealthCheck(connectionId, bucket)`. Builds S3Client, runs probes via `Promise.allSettled` with 5s per-probe timeout, persists results, returns `HealthReport`. |
| `src/lib/health/mutex.ts` | Per-process `Map<string, Promise>` mutex so simultaneous POSTs for the same scope share one run |
| `src/lib/health/classify.test.ts` | Unit tests for `classifyError` |
| `src/lib/health/rollup.test.ts` | Unit tests for capability rollup logic |
| `src/lib/health/runner.test.ts` | Integration tests against a fake `S3Client.send` |
| `src/app/api/connections/[id]/health-check/route.ts` | `GET`/`POST` for connection-level report |
| `src/app/api/connections/[id]/health-check/summary/route.ts` | `GET` lightweight rollup across connection + all per-bucket reports for the connection (used by feature gating) |
| `src/app/api/connections/[id]/buckets/[bucket]/health-check/route.ts` | `GET`/`POST` for per-bucket report |
| `src/lib/queries/health.ts` | React Query hooks: `useConnectionHealth`, `useBucketHealth`, `useHealthSummary`, `useRunConnectionHealth`, `useRunBucketHealth`, `useCapability` |
| `src/components/health/capability-gate.tsx` | `<CapabilityGate>` primitive used by every gated button |
| `src/components/health/capability-row.tsx` | Collapsible capability row shared by both diagnostic page layouts |
| `src/components/health/health-report.tsx` | Shared report layout (header, staleness banner, capability list) — props-driven so connection and bucket pages both reuse it |
| `src/components/health/permissions-card.tsx` | Compact summary card rendered on the Bucket Overview tab |
| `src/app/(dashboard)/connections/[id]/health/page.tsx` | Connection diagnostic page |
| `src/app/(dashboard)/connections/[id]/buckets/[bucket]/health/page.tsx` | Bucket diagnostic page |
| `prisma/migrations/<timestamp>_credential_health_check/migration.sql` | Migration for the four new tables |

**Modified files:**

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `ConnectionHealthCheck`, `ConnectionPermissionCheck`, `BucketHealthCheck`, `BucketPermissionCheck` models + back-relations on `Connection` |
| `src/lib/queries/keys.ts` | Add `health: { connection(id), bucket(id, bucket), summary(id) }` query-key factory entries |
| `src/lib/db/connections.ts` | In `updateConnection`: if `endpoint`/`accessKeyId`/`secretAccessKey`/`region`/`forcePathStyle` changed, delete health rows in the same transaction and trigger non-blocking re-run |
| `src/app/api/connections/route.ts` | After successful `createConnection`, kick off `runConnectionHealthCheck(id)` non-blocking (`.catch(logError)`) |
| `src/components/connections/connection-list.tsx` | Add "Health" link to each connection card |
| `src/components/buckets/overview-tab.tsx` | Add `<PermissionsCard />` to the grid layout |
| `src/components/browser/upload-button.tsx` (and similar entry points for upload/folder/delete/copy/rename/etc.) | Wrap actions in `<CapabilityGate>` |

### Probe interface

```ts
// src/lib/health/probe.ts
import type { S3Client } from "@aws-sdk/client-s3";

export type ProbeResult = "granted" | "denied" | "unsupported" | "error" | "skipped";
export type CapabilityKey =
  | "browse-buckets" | "create-buckets" | "delete-buckets"
  | "browse-objects" | "download-objects" | "upload-objects"
  | "delete-objects" | "copy-objects" | "object-tagging"
  | "list-versions" | "manage-versioning" | "view-multipart";

export interface ProbeContext {
  client: S3Client;
  bucket?: string;        // present only for bucket-scoped probes
  randomKey: string;      // `__s3client-healthcheck__/probe-${uuid}` — shared within one run
}

export interface ProbeRunOutcome {
  result: ProbeResult;
  errorCode?: string;     // SDK error name or HTTP status, e.g. "AccessDenied", "NotImplemented", "timeout"
  durationMs: number;
}

export interface Probe {
  key: string;
  capability: CapabilityKey;
  scope: "connection" | "bucket";
  required: boolean;
  run: (ctx: ProbeContext) => Promise<ProbeRunOutcome>;
}
```

### Error classification

Single pure function used by every probe — keeps interpretation consistent.

```ts
// src/lib/health/classify.ts
export function classifyError(err: unknown): { result: ProbeResult; errorCode: string } {
  if (!err || typeof err !== "object") return { result: "error", errorCode: "unknown" };
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; Code?: string };
  const status = e.$metadata?.httpStatusCode;
  const name = e.name ?? e.Code ?? "";

  // Granted: auth succeeded; failure was due to our intentional no-op
  if (name === "NoSuchKey" || name === "NoSuchBucket" || name === "NotFound") return { result: "granted", errorCode: name };
  if (name === "PreconditionFailed" || status === 412) return { result: "granted", errorCode: "PreconditionFailed" };

  // Denied
  if (name === "AccessDenied" || name === "Forbidden" || status === 403) return { result: "denied", errorCode: name || "Forbidden" };

  // Unsupported
  if (name === "NotImplemented" || status === 501) return { result: "unsupported", errorCode: "NotImplemented" };

  // Network / timeout (set by the runner timeout wrapper before reaching here)
  if (name === "TimeoutError") return { result: "error", errorCode: "timeout" };
  if (name === "NetworkingError" || name === "ECONNREFUSED" || name === "ENOTFOUND") return { result: "error", errorCode: "network" };

  return { result: "error", errorCode: name || `status:${status ?? "unknown"}` };
}
```

Probe `run` implementations are tiny — build the command, call `client.send`, classify any thrown error, classify success as `granted`.

### Capability rollup

```ts
// src/lib/health/rollup.ts
export function rollupCapability(
  capability: CapabilityKey,
  probes: Array<{ key: string; result: ProbeResult; required: boolean }>,
): CapabilityStatus {
  const required = probes.filter(p => p.required && p.result !== "skipped");
  if (required.length === 0) return "untested";
  if (required.some(p => p.result === "denied")) return "unavailable";
  if (required.some(p => p.result === "unsupported")) return "unsupported";
  if (required.some(p => p.result === "error")) return "unknown";
  return "available";
}
```

Pure, no side effects, exhaustively unit-tested.

### Runner

```ts
// src/lib/health/runner.ts (signatures only)
export async function runConnectionHealthCheck(connectionId: string): Promise<HealthReport>;
export async function runBucketHealthCheck(connectionId: string, bucket: string): Promise<HealthReport>;
```

Implementation outline:

1. Acquire the mutex for the scope (key: `connection:${id}` or `bucket:${id}:${name}`). If another run is in flight, await it and return its result.
2. Load `Connection` from DB via `prisma.connection.findUnique`. Throw 404 if missing.
3. Build `S3Client` via `createS3Client(connectionConfig)`.
4. Generate `randomKey = `__s3client-healthcheck__/probe-${crypto.randomUUID()}``.
5. Select probes (connection or bucket scope) from registry.
6. For each probe, wrap `probe.run(ctx)` in `Promise.race([run, timeoutAfter(5000)])`. Run all in parallel with `Promise.allSettled`.
7. Build connectivity flag from non-skipped probe results:
   - If every non-skipped probe has `result: "error"` with `errorCode` in `{network, timeout}` → `connectivity = "unreachable"`
   - Else if every non-skipped per-bucket probe failed with `errorCode: "NoSuchBucket"` → `connectivity = "missing-bucket"`
   - Else → `connectivity = "ok"`
8. Persist in a transaction:
   - Re-check `Connection` still exists; if not, abort (no persist).
   - Re-check `Connection.updatedAt` hasn't changed since step 2; if it has, abort (credentials were edited mid-run).
   - Upsert `(Connection|Bucket)HealthCheck` row; delete old `PermissionCheck` rows for it; insert new ones.
9. Roll up into capabilities, return `HealthReport`.
10. Release mutex.

Per-probe timeout is 5s; whole-run safety net is 30s (set on the AbortController passed into the S3Client).

### Data model

```prisma
model ConnectionHealthCheck {
  id           String   @id @default(cuid())
  connectionId String   @unique
  checkedAt    DateTime
  durationMs   Int
  connectivity String   // "ok" | "unreachable"
  connection   Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  probes       ConnectionPermissionCheck[]
}

model ConnectionPermissionCheck {
  id            String   @id @default(cuid())
  healthCheckId String
  probeKey      String
  result        String   // "granted" | "denied" | "unsupported" | "error"
  errorCode     String?
  durationMs    Int
  healthCheck   ConnectionHealthCheck @relation(fields: [healthCheckId], references: [id], onDelete: Cascade)

  @@unique([healthCheckId, probeKey])
}

model BucketHealthCheck {
  id           String   @id @default(cuid())
  connectionId String
  bucket       String
  checkedAt    DateTime
  durationMs   Int
  connectivity String   // "ok" | "unreachable" | "missing-bucket"
  connection   Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  probes       BucketPermissionCheck[]

  @@unique([connectionId, bucket])
}

model BucketPermissionCheck {
  id            String   @id @default(cuid())
  healthCheckId String
  probeKey      String
  result        String
  errorCode     String?
  durationMs    Int
  healthCheck   BucketHealthCheck @relation(fields: [healthCheckId], references: [id], onDelete: Cascade)

  @@unique([healthCheckId, probeKey])
}
```

Back-relations added to the existing `Connection` model:

```prisma
healthCheck         ConnectionHealthCheck?
bucketHealthChecks  BucketHealthCheck[]
```

### API contracts

#### `GET /api/connections/[id]/health-check`

**Auth:** `withAuth` + `getConnectionAccessById`. Any role with access can read.

**Response 200:** `HealthReport` (see shape below).
**Response 404:** `{ error: "not_run" }` when no persisted row exists yet.
**Response 403:** non-member.

#### `POST /api/connections/[id]/health-check`

**Auth:** `withAuth` + `getConnectionAccessById`. Requires `ADMIN` role (matches `/connections/test`).

**Body:** none.
**Response 200:** fresh `HealthReport`.
**Response 502:** when connectivity == "unreachable" (still returns the report so the UI can show specific guidance).

#### `GET /api/connections/[id]/buckets/[bucket]/health-check` and `POST` same

Mirrors the connection-level routes, scoped to a bucket. `POST` requires any role with access (not ADMIN-only) — bucket-level checks are routine usage, not a destructive admin operation.

#### `GET /api/connections/[id]/health-check/summary`

**Response 200:**
```ts
{
  connectionId: string;
  connection: Record<CapabilityKey, CapabilityStatus> | null;
  buckets: Record<string /* bucket name */, Record<CapabilityKey, CapabilityStatus>>;
  staleBuckets: string[];   // bucket names whose checkedAt is older than 7 days
  isConnectionStale: boolean;
}
```

This is the endpoint that feature gating consumes — small, fast, denormalized for the lookup `useCapability` does on every render.

### `HealthReport` response shape

```ts
type CapabilityStatus =
  | "available" | "unavailable" | "unsupported" | "unknown" | "untested";

interface HealthReport {
  scope: "connection" | "bucket";
  connectionId: string;
  bucket?: string;
  checkedAt: string;        // ISO
  isStale: boolean;         // checkedAt older than 7 days (threshold constant)
  durationMs: number;
  connectivity: "ok" | "unreachable" | "missing-bucket";
  capabilities: Array<{
    key: CapabilityKey;
    label: string;
    status: CapabilityStatus;
    probes: Array<{
      key: string;
      result: ProbeResult;
      errorCode?: string;
    }>;
    requiredIamActions: string[];
    affects: string[];      // human-readable list of UI surfaces — sourced from capabilities.ts
  }>;
}
```

### Auto-run + invalidation

- **On connection create.** `POST /api/connections` calls `createConnection`, then fires `runConnectionHealthCheck(id).catch(logError)` in a non-blocking way (no `await`). The response returns the new connection immediately. The client navigates to the connection page; the page's `useConnectionHealth` hook polls.
- **On credential edit.** `updateConnection` in `src/lib/db/connections.ts` checks whether any of `endpoint`, `accessKeyId`, `secretAccessKey`, `region`, `forcePathStyle` changed. If so, deletes the `ConnectionHealthCheck` row and all `BucketHealthCheck` rows for the connection in the same transaction, then fires `runConnectionHealthCheck(id).catch(logError)` non-blocking. Per-bucket checks remain absent until their bucket is next visited.
- **On bucket page visit.** `useBucketHealth(id, bucket)` calls `GET`. If 404, calls `POST` automatically. Polls until report appears or 30s timeout.
- **Manual refresh.** Every report surface has a "Refresh" button that fires the matching `POST` mutation; React Query invalidates the relevant key on success.
- **Staleness.** `isStale = checkedAt < now - 7days`. Staleness only affects UI ("X days old" badge); does not invalidate the cache. Users refresh manually.

### React Query layer

```ts
// src/lib/queries/keys.ts (additions)
health: {
  all: ["health"] as const,
  connection: (id: string) => [...queryKeys.health.all, "connection", id] as const,
  bucket: (id: string, bucket: string) => [...queryKeys.health.all, "bucket", id, bucket] as const,
  summary: (id: string) => [...queryKeys.health.all, "summary", id] as const,
},
```

```ts
// src/lib/queries/health.ts
export function useConnectionHealth(connectionId: string): UseQueryResult<HealthReport | null>;
export function useBucketHealth(connectionId: string, bucket: string): UseQueryResult<HealthReport | null>;
export function useHealthSummary(connectionId: string): UseQueryResult<HealthSummary>;
export function useRunConnectionHealth(): UseMutationResult<HealthReport, Error, { connectionId: string }>;
export function useRunBucketHealth(): UseMutationResult<HealthReport, Error, { connectionId: string; bucket: string }>;
export function useCapability(
  connectionId: string,
  bucket: string | undefined,
  capability: CapabilityKey,
): { status: CapabilityStatus; reason: string | null; isLoading: boolean };
```

`useCapability` reads from the summary endpoint via `useHealthSummary`. Resolution rules:
- `isLoading || summary == null`: return `{ status: "available", reason: null, isLoading: true }` (permissive default)
- `bucket` provided: look up `summary.buckets[bucket]?.[capability]`. If missing, return `"available"` (lazy bucket check hasn't run yet).
- No `bucket`: look up `summary.connection?.[capability]`.

`reason` is a pre-formatted human string built from `requiredIamActions` for tooltip display.

### Mutex (race condition handling)

```ts
// src/lib/health/mutex.ts
const inflight = new Map<string, Promise<HealthReport>>();

export async function withMutex<T extends HealthReport>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
```

Keys: `connection:${id}` for connection runs, `bucket:${id}:${name}` for bucket runs. Two simultaneous POSTs for the same scope share one S3 round trip and both receive the same result.

---

## Error handling

| Failure mode | Probe behavior | Capability rollup | UI |
|---|---|---|---|
| `AccessDenied` / `403` | `denied`, errorCode `AccessDenied` | `unavailable` | Red X + IAM actions + "Affects" list |
| `NotImplemented` / `501` | `unsupported`, errorCode `NotImplemented` | `unsupported` | Gray dash + "Not supported by this provider" |
| Probe not applicable (e.g. `put-bucket-versioning` on never-versioned bucket) | `skipped`, no errorCode | filtered out before rollup | Probe row hidden in expanded probe details unless toggled; capability status driven by remaining required probes |
| Network / DNS / ECONNREFUSED | `error`, errorCode `network` | `unknown` | If all probes fail this way, `connectivity = "unreachable"` and the UI shows connectivity-error banner instead of capability list |
| Timeout (5s per probe) | `error`, errorCode `timeout` | `unknown` | Gray question mark + "Timed out — retry" |
| `NoSuchBucket` on every per-bucket probe | varies | varies | `connectivity = "missing-bucket"` — UI shows "Bucket no longer exists" + offer to remove from bookmarks |
| Unexpected 4xx | `error`, errorCode `unexpected:<status>` | `unknown` | Gray question mark + raw error code |
| Unexpected 5xx | `error`, errorCode `server` | `unknown` | Same |
| Probe code throws synchronously | `error`, errorCode `exception` | `unknown` | Same; server-side log captures stack |
| `Connection` deleted mid-run | runner discards result, no persist | — | Run resolves silently; next `GET` returns 404 (which is correct — connection is gone) |
| Credentials edited mid-run | runner detects via `updatedAt` change, discards result | — | New run already kicked off by `updateConnection`; client polls and eventually sees fresh result |
| Concurrent POST for same scope | mutex resolves to same Promise | — | Both clients get same response, no duplicate S3 calls |
| DB write failure mid-persist | transaction rolls back; runner throws | — | API returns 500; client shows "Couldn't save report — retry" |

**Observability:** Each run logs one structured line on completion:
```
[health] connectionId=<id> scope=<connection|bucket> bucket=<name?> durationMs=<n> connectivity=<state> granted=<n> denied=<n> unsupported=<n> errors=<n> skipped=<n>
```

Server-side `console.log` is sufficient — no metrics backend in v1.

---

## Testing

### `src/lib/health/classify.test.ts`

Pure unit tests for `classifyError`:

- AWS SDK errors with `name === "AccessDenied"` → `denied`
- `name === "NoSuchKey"` → `granted`
- `name === "NoSuchBucket"` → `granted`
- `name === "NotFound"` → `granted`
- `name === "PreconditionFailed"` → `granted`
- HTTP 403 with no name → `denied`
- HTTP 412 with no name → `granted`
- `name === "NotImplemented"` or HTTP 501 → `unsupported`
- `name === "TimeoutError"` → `error` with `errorCode: "timeout"`
- `name === "NetworkingError"` → `error` with `errorCode: "network"`
- Unknown shape (`null`, `undefined`, plain object) → `error`
- Unexpected 4xx (e.g. 400 BadRequest) → `error` with `errorCode: "BadRequest"` or `"status:400"`
- Unexpected 5xx → `error` with `errorCode: "server"` or `"status:500"`

### `src/lib/health/rollup.test.ts`

Pure unit tests for `rollupCapability`:

- Empty required list → `untested`
- All required `granted` → `available`
- One required `denied`, rest `granted` → `unavailable`
- One required `denied`, one `unsupported`, one `granted` → `unavailable` (denied wins)
- One required `unsupported`, rest `granted` → `unsupported`
- One required `unsupported`, one `error`, rest `granted` → `unsupported` (unsupported > error)
- One required `error`, rest `granted` → `unknown`
- Non-required probes are ignored in rollup (only required ones drive status)
- All required `skipped` → `untested`
- One required `skipped`, one `granted` → `available` (skipped is filtered out, then rollup runs)
- One required `skipped`, one `denied` → `unavailable` (skipped filtered, denied wins)

### `src/lib/health/runner.test.ts`

Integration tests against a fake `S3Client.send` that returns scripted responses keyed by command name:

- All probes succeed → all capabilities `available`, `connectivity: "ok"`, persisted rows match
- All probes throw `AccessDenied` → all capabilities `unavailable`
- All probes throw `NetworkingError` → all capabilities `unknown`, `connectivity: "unreachable"`
- All bucket probes throw `NoSuchBucket` → `connectivity: "missing-bucket"`
- One probe times out (mock delays > 5s) → that probe returns `error` with `errorCode: "timeout"`, others succeed
- `put-bucket-versioning` on a never-versioned bucket → probe returns `skipped`, capability `manage-versioning` rolls up to `available` based on `get-bucket-versioning` granted
- Mutex: two simultaneous calls to `runConnectionHealthCheck(sameId)` → fake `send` is called once per probe, both promises resolve to the same report
- Credential edit mid-run: mock `Connection.updatedAt` changing between read and persist → result discarded, no DB write
- Connection deleted mid-run: persist transaction aborts cleanly

### `src/lib/db/connections.test.ts` (extend existing)

- `updateConnection` with unchanged credentials → health rows untouched
- `updateConnection` changing `accessKeyId` → `ConnectionHealthCheck` and all matching `BucketHealthCheck` rows deleted in same transaction
- Same for `secretAccessKey`, `endpoint`, `region`, `forcePathStyle`

### API route tests

`src/app/api/connections/[id]/health-check/route.test.ts`:

- `GET` for connection with persisted row → 200 + serialized report
- `GET` for connection with no row → 404 `{ error: "not_run" }`
- `GET` for non-member → 403
- `POST` as ADMIN → 200, runner invoked, fresh report persisted
- `POST` as non-ADMIN → 403
- `POST` when connectivity is unreachable → 502 with report body

Same shape for bucket-level routes (with role gate relaxed — any access role can POST).

### Manual smoke checklist

- [ ] Add a new connection with full-access credentials → connection page shows health check running, then all capabilities green
- [ ] Add a connection with read-only credentials → connection-level: Browse buckets green, Delete buckets red; opening a bucket: Browse + Download + List versions green, Upload/Delete/etc. red
- [ ] Open a bucket whose IAM policy denies `s3:PutObject` → Permissions card shows Upload as unavailable; upload button is disabled; tooltip shows "You don't have s3:PutObject…"
- [ ] Click "Refresh" on the connection diagnostic page → button shows refreshing state, then report updates
- [ ] Wait until a report is 7+ days old (or backdate `checkedAt`) → staleness banner appears
- [ ] Edit a connection's access key → connection-level check re-runs automatically; bucket-level reports are wiped and re-run on next bucket visit
- [ ] Point a connection at an unreachable endpoint → diagnostic page shows "Couldn't reach endpoint" banner instead of capability list
- [ ] Delete a bucket out-of-band, then refresh its bucket diagnostic page → shows "Bucket no longer exists" + offer to remove bookmark
- [ ] Connect to an R2 endpoint without versioning enabled → "Manage versioning" shows as `unsupported` with the "Not supported by this provider" copy (not red)
- [ ] On a non-ADMIN connection role: GET health works, POST returns 403
- [ ] Two browser tabs open same connection and both click Refresh simultaneously → only one set of S3 calls visible in logs (mutex), both tabs receive same result
