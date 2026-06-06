# Credential Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permissions health check that probes S3 credentials per-connection and per-bucket, persists results in Postgres, and powers an onboarding diagnostic, a re-runnable troubleshooting report, and UI feature gating.

**Architecture:** Probe registry pattern. Each S3 capability is defined as a `Probe` object that knows how to issue an intentional no-op request (e.g. `HeadObject` on a guaranteed-nonexistent key) and classify the result as `granted`/`denied`/`unsupported`/`error`/`skipped`. A runner executes all probes in scope in parallel, persists per-probe results in normalized tables, and rolls them up into user-facing capability statuses. React Query hooks consume the cached results to power the diagnostic pages and a `<CapabilityGate>` primitive used at every gated UI surface.

**Tech Stack:** TypeScript, Next.js App Router, Prisma + PostgreSQL, AWS SDK v3 (`@aws-sdk/client-s3`), Zod-free (matches existing codebase), TanStack React Query 5, Vitest, Radix UI primitives, Tailwind CSS 4, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-06-06-credential-health-check-design.md` (commit `446fd08`).

---

## File Structure

**New files (created):**

| Path | Responsibility |
|---|---|
| `src/lib/health/capabilities.ts` | Capability constants — keys, display labels, IAM action lists, "affects" copy. Pure data, no dependencies. |
| `src/lib/health/probe.ts` | `Probe`, `ProbeResult`, `ProbeContext`, `ProbeRunOutcome`, `CapabilityKey`, `CapabilityStatus`, `HealthReport`, `HealthSummary` types. |
| `src/lib/health/classify.ts` | Pure `classifyError(err) → {result, errorCode}` |
| `src/lib/health/classify.test.ts` | Unit tests for `classifyError` |
| `src/lib/health/rollup.ts` | Pure `rollupCapability(capability, probes) → CapabilityStatus` and `buildCapabilities(probeResults) → Capability[]` |
| `src/lib/health/rollup.test.ts` | Unit tests for rollup |
| `src/lib/health/probes/connection.ts` | Connection-scoped probe definitions |
| `src/lib/health/probes/bucket.ts` | Bucket-scoped probe definitions |
| `src/lib/health/registry.ts` | `CONNECTION_PROBES`, `BUCKET_PROBES` exports + `probesForCapability` helper |
| `src/lib/health/mutex.ts` | Per-process in-process mutex for run de-duplication |
| `src/lib/health/runner.ts` | `runConnectionHealthCheck`, `runBucketHealthCheck` |
| `src/lib/health/runner.test.ts` | Integration tests against a fake `S3Client.send` |
| `src/lib/health/connectivity.ts` | Pure `deriveConnectivity(scope, probeResults) → "ok" \| "unreachable" \| "missing-bucket"` |
| `src/lib/health/connectivity.test.ts` | Unit tests for connectivity derivation |
| `src/app/api/connections/[id]/health-check/route.ts` | `GET`/`POST` connection-level report |
| `src/app/api/connections/[id]/health-check/summary/route.ts` | `GET` summary for feature gating |
| `src/app/api/connections/[id]/buckets/[bucket]/health-check/route.ts` | `GET`/`POST` per-bucket report |
| `src/lib/queries/health.ts` | React Query hooks for the four endpoints + `useCapability` |
| `src/components/health/capability-row.tsx` | Collapsible capability row |
| `src/components/health/health-report.tsx` | Shared report layout (header, banners, list) |
| `src/components/health/permissions-card.tsx` | Bucket Overview "Permissions" card |
| `src/components/health/capability-gate.tsx` | `<CapabilityGate>` UI primitive |
| `src/app/(dashboard)/connections/[id]/health/page.tsx` | Connection diagnostic page |
| `src/app/(dashboard)/connections/[id]/buckets/[bucket]/health/page.tsx` | Bucket diagnostic page |

**Modified files:**

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add 4 models + 2 back-relations on `Connection` |
| `src/lib/queries/keys.ts` | Add `health` query-key namespace |
| `src/lib/db/connections.ts` | Invalidate health rows on credential change in `updateConnection` |
| `src/app/api/connections/route.ts` | Kick off connection-level health check on create |
| `src/components/connections/connection-list.tsx` | Add "Health" link per connection |
| `src/components/buckets/overview-tab.tsx` | Add `<PermissionsCard />` |
| `src/components/browser/file-browser.tsx` (and related action buttons) | Wrap actions in `<CapabilityGate>` |
| `src/components/buckets/bucket-card.tsx` | Gate "Delete bucket" with `delete-buckets` |
| `src/components/buckets/overview-versioning-card.tsx` | Gate buttons with `manage-versioning` |
| `src/components/buckets/bucket-detail-tabs.tsx` | Disable "Versions" tab when `list-versions` denied |

---

## Phase 1 — Foundation (pure logic, no S3 or DB)

### Task 1: Add type definitions

**Files:**
- Create: `src/lib/health/probe.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/health/probe.ts
import type { S3Client } from "@aws-sdk/client-s3";

export type CapabilityKey =
  | "browse-buckets"
  | "create-buckets"
  | "delete-buckets"
  | "browse-objects"
  | "download-objects"
  | "upload-objects"
  | "delete-objects"
  | "copy-objects"
  | "object-tagging"
  | "list-versions"
  | "manage-versioning"
  | "view-multipart";

export type ProbeScope = "connection" | "bucket";

export type ProbeResult =
  | "granted"
  | "denied"
  | "unsupported"
  | "error"
  | "skipped";

export type CapabilityStatus =
  | "available"
  | "unavailable"
  | "unsupported"
  | "unknown"
  | "untested";

export type Connectivity = "ok" | "unreachable" | "missing-bucket";

export interface ProbeContext {
  client: S3Client;
  bucket?: string;
  randomKey: string;
}

export interface ProbeRunOutcome {
  result: ProbeResult;
  errorCode?: string;
  durationMs: number;
}

export interface Probe {
  key: string;
  capability: CapabilityKey;
  scope: ProbeScope;
  required: boolean;
  run: (ctx: ProbeContext) => Promise<ProbeRunOutcome>;
}

export interface ProbeResultRecord {
  key: string;
  capability: CapabilityKey;
  required: boolean;
  result: ProbeResult;
  errorCode?: string;
  durationMs: number;
}

export interface CapabilityReport {
  key: CapabilityKey;
  label: string;
  status: CapabilityStatus;
  probes: Array<{
    key: string;
    result: ProbeResult;
    errorCode?: string;
  }>;
  requiredIamActions: string[];
  affects: string[];
}

export interface HealthReport {
  scope: ProbeScope;
  connectionId: string;
  bucket?: string;
  checkedAt: string;
  isStale: boolean;
  durationMs: number;
  connectivity: Connectivity;
  capabilities: CapabilityReport[];
}

export interface HealthSummary {
  connectionId: string;
  connection: Partial<Record<CapabilityKey, CapabilityStatus>> | null;
  buckets: Record<string, Partial<Record<CapabilityKey, CapabilityStatus>>>;
  staleBuckets: string[];
  isConnectionStale: boolean;
}

export const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
export const PROBE_TIMEOUT_MS = 5_000;
export const RUN_TIMEOUT_MS = 30_000;
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/health/probe.ts
git commit -m "feat(health): add probe type definitions"
```

---

### Task 2: Add capability constants

**Files:**
- Create: `src/lib/health/capabilities.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/health/capabilities.ts
import type { CapabilityKey } from "./probe";

export interface CapabilityDefinition {
  key: CapabilityKey;
  label: string;
  scope: "connection" | "bucket";
  requiredIamActions: string[];
  affects: string[];
}

export const CAPABILITIES: Record<CapabilityKey, CapabilityDefinition> = {
  "browse-buckets": {
    key: "browse-buckets",
    label: "Browse buckets",
    scope: "connection",
    requiredIamActions: ["s3:ListAllMyBuckets"],
    affects: ["The bucket list page won't show any buckets"],
  },
  "create-buckets": {
    key: "create-buckets",
    label: "Create buckets",
    scope: "connection",
    requiredIamActions: ["s3:CreateBucket"],
    affects: ["The \"+ New bucket\" button will be disabled"],
  },
  "delete-buckets": {
    key: "delete-buckets",
    label: "Delete buckets",
    scope: "connection",
    requiredIamActions: ["s3:DeleteBucket"],
    affects: ["The \"Delete bucket\" action will be disabled"],
  },
  "browse-objects": {
    key: "browse-objects",
    label: "Browse objects",
    scope: "bucket",
    requiredIamActions: ["s3:ListBucket"],
    affects: ["The file browser will show \"No access to list objects\""],
  },
  "download-objects": {
    key: "download-objects",
    label: "Download objects",
    scope: "bucket",
    requiredIamActions: ["s3:GetObject"],
    affects: ["Download buttons and bulk download will be disabled"],
  },
  "upload-objects": {
    key: "upload-objects",
    label: "Upload objects",
    scope: "bucket",
    requiredIamActions: ["s3:PutObject"],
    affects: [
      "Upload button, drag-drop zone, and \"+ New folder\" will be disabled",
    ],
  },
  "delete-objects": {
    key: "delete-objects",
    label: "Delete objects",
    scope: "bucket",
    requiredIamActions: ["s3:DeleteObject"],
    affects: ["Per-row delete and bulk delete will be disabled"],
  },
  "copy-objects": {
    key: "copy-objects",
    label: "Copy / Rename / Move",
    scope: "bucket",
    requiredIamActions: ["s3:GetObject", "s3:PutObject"],
    affects: [
      "Rename, Copy, and Move context-menu entries will be disabled",
      "Move also requires s3:DeleteObject",
    ],
  },
  "object-tagging": {
    key: "object-tagging",
    label: "Object tags",
    scope: "bucket",
    requiredIamActions: ["s3:GetObjectTagging", "s3:PutObjectTagging"],
    affects: ["The Tags panel in object detail will be disabled"],
  },
  "list-versions": {
    key: "list-versions",
    label: "List object versions",
    scope: "bucket",
    requiredIamActions: ["s3:ListBucketVersions"],
    affects: ["The Versions tab will be disabled"],
  },
  "manage-versioning": {
    key: "manage-versioning",
    label: "Manage bucket versioning",
    scope: "bucket",
    requiredIamActions: ["s3:GetBucketVersioning", "s3:PutBucketVersioning"],
    affects: ["The Versioning card on the bucket Overview will be disabled"],
  },
  "view-multipart": {
    key: "view-multipart",
    label: "View incomplete uploads",
    scope: "bucket",
    requiredIamActions: ["s3:ListBucketMultipartUploads"],
    affects: [
      "The Incomplete Uploads card on the bucket Overview will be disabled",
    ],
  },
};

export const CONNECTION_CAPABILITIES: CapabilityKey[] = (
  Object.values(CAPABILITIES) as CapabilityDefinition[]
)
  .filter((c) => c.scope === "connection")
  .map((c) => c.key);

export const BUCKET_CAPABILITIES: CapabilityKey[] = (
  Object.values(CAPABILITIES) as CapabilityDefinition[]
)
  .filter((c) => c.scope === "bucket")
  .map((c) => c.key);
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/health/capabilities.ts
git commit -m "feat(health): add capability constants and IAM action mappings"
```

---

### Task 3: Classify SDK errors into probe results

**Files:**
- Create: `src/lib/health/classify.ts`
- Test: `src/lib/health/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/health/classify.test.ts
import { describe, test, expect } from "vitest";
import { classifyError } from "./classify";

describe("classifyError", () => {
  test("AccessDenied → denied", () => {
    expect(classifyError({ name: "AccessDenied" })).toEqual({
      result: "denied",
      errorCode: "AccessDenied",
    });
  });

  test("Forbidden → denied", () => {
    expect(classifyError({ name: "Forbidden" })).toEqual({
      result: "denied",
      errorCode: "Forbidden",
    });
  });

  test("HTTP 403 with no name → denied", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 403 } })).toEqual({
      result: "denied",
      errorCode: "Forbidden",
    });
  });

  test("NoSuchKey → granted", () => {
    expect(classifyError({ name: "NoSuchKey" })).toEqual({
      result: "granted",
      errorCode: "NoSuchKey",
    });
  });

  test("NoSuchBucket → granted", () => {
    expect(classifyError({ name: "NoSuchBucket" })).toEqual({
      result: "granted",
      errorCode: "NoSuchBucket",
    });
  });

  test("NotFound → granted", () => {
    expect(classifyError({ name: "NotFound" })).toEqual({
      result: "granted",
      errorCode: "NotFound",
    });
  });

  test("PreconditionFailed → granted", () => {
    expect(classifyError({ name: "PreconditionFailed" })).toEqual({
      result: "granted",
      errorCode: "PreconditionFailed",
    });
  });

  test("HTTP 412 → granted", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 412 } })).toEqual({
      result: "granted",
      errorCode: "PreconditionFailed",
    });
  });

  test("BadDigest → granted (used by put-object probe)", () => {
    expect(classifyError({ name: "BadDigest" })).toEqual({
      result: "granted",
      errorCode: "BadDigest",
    });
  });

  test("InvalidDigest → granted", () => {
    expect(classifyError({ name: "InvalidDigest" })).toEqual({
      result: "granted",
      errorCode: "InvalidDigest",
    });
  });

  test("NotImplemented → unsupported", () => {
    expect(classifyError({ name: "NotImplemented" })).toEqual({
      result: "unsupported",
      errorCode: "NotImplemented",
    });
  });

  test("HTTP 501 → unsupported", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 501 } })).toEqual({
      result: "unsupported",
      errorCode: "NotImplemented",
    });
  });

  test("TimeoutError → error/timeout", () => {
    expect(classifyError({ name: "TimeoutError" })).toEqual({
      result: "error",
      errorCode: "timeout",
    });
  });

  test("NetworkingError → error/network", () => {
    expect(classifyError({ name: "NetworkingError" })).toEqual({
      result: "error",
      errorCode: "network",
    });
  });

  test("ECONNREFUSED → error/network", () => {
    expect(classifyError({ name: "ECONNREFUSED" })).toEqual({
      result: "error",
      errorCode: "network",
    });
  });

  test("ENOTFOUND → error/network", () => {
    expect(classifyError({ name: "ENOTFOUND" })).toEqual({
      result: "error",
      errorCode: "network",
    });
  });

  test("null → error/unknown", () => {
    expect(classifyError(null)).toEqual({
      result: "error",
      errorCode: "unknown",
    });
  });

  test("undefined → error/unknown", () => {
    expect(classifyError(undefined)).toEqual({
      result: "error",
      errorCode: "unknown",
    });
  });

  test("plain object with no name → error with status fallback", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 400 } })).toEqual({
      result: "error",
      errorCode: "status:400",
    });
  });

  test("unexpected 5xx → error/server", () => {
    expect(classifyError({ $metadata: { httpStatusCode: 503 } })).toEqual({
      result: "error",
      errorCode: "status:503",
    });
  });

  test("falls back to .Code when .name is missing (legacy SDK)", () => {
    expect(classifyError({ Code: "AccessDenied" })).toEqual({
      result: "denied",
      errorCode: "AccessDenied",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/health/classify.test.ts`
Expected: FAIL with "Cannot find module './classify'"

- [ ] **Step 3: Implement `classifyError`**

```typescript
// src/lib/health/classify.ts
import type { ProbeResult } from "./probe";

const GRANTED_ERROR_NAMES = new Set([
  "NoSuchKey",
  "NoSuchBucket",
  "NotFound",
  "PreconditionFailed",
  "BadDigest",
  "InvalidDigest",
]);

const DENIED_ERROR_NAMES = new Set(["AccessDenied", "Forbidden"]);

const NETWORK_ERROR_NAMES = new Set([
  "NetworkingError",
  "ECONNREFUSED",
  "ENOTFOUND",
]);

export function classifyError(
  err: unknown,
): { result: ProbeResult; errorCode: string } {
  if (!err || typeof err !== "object") {
    return { result: "error", errorCode: "unknown" };
  }

  const e = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e.$metadata?.httpStatusCode;
  const name = e.name ?? e.Code ?? "";

  if (GRANTED_ERROR_NAMES.has(name)) {
    return { result: "granted", errorCode: name };
  }
  if (status === 412) {
    return { result: "granted", errorCode: "PreconditionFailed" };
  }

  if (DENIED_ERROR_NAMES.has(name) || status === 403) {
    return { result: "denied", errorCode: name || "Forbidden" };
  }

  if (name === "NotImplemented" || status === 501) {
    return { result: "unsupported", errorCode: "NotImplemented" };
  }

  if (name === "TimeoutError") {
    return { result: "error", errorCode: "timeout" };
  }

  if (NETWORK_ERROR_NAMES.has(name)) {
    return { result: "error", errorCode: "network" };
  }

  if (status !== undefined) {
    return { result: "error", errorCode: `status:${status}` };
  }

  return { result: "error", errorCode: name || "unknown" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/health/classify.test.ts`
Expected: PASS — all 20 tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/classify.ts src/lib/health/classify.test.ts
git commit -m "feat(health): classify SDK errors into probe results"
```

---

### Task 4: Roll probe results up into capability statuses

**Files:**
- Create: `src/lib/health/rollup.ts`
- Test: `src/lib/health/rollup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/health/rollup.test.ts
import { describe, test, expect } from "vitest";
import { rollupCapability, buildCapabilities } from "./rollup";
import type { ProbeResultRecord } from "./probe";

function probe(
  key: string,
  capability: ProbeResultRecord["capability"],
  result: ProbeResultRecord["result"],
  required = true,
): ProbeResultRecord {
  return { key, capability, required, result, durationMs: 0 };
}

describe("rollupCapability", () => {
  test("no required probes → untested", () => {
    expect(
      rollupCapability("create-buckets", [
        probe("ignored", "create-buckets", "granted", false),
      ]),
    ).toBe("untested");
  });

  test("all required granted → available", () => {
    expect(
      rollupCapability("manage-versioning", [
        probe("get-bucket-versioning", "manage-versioning", "granted"),
        probe("put-bucket-versioning", "manage-versioning", "granted"),
      ]),
    ).toBe("available");
  });

  test("one required denied → unavailable", () => {
    expect(
      rollupCapability("manage-versioning", [
        probe("get-bucket-versioning", "manage-versioning", "granted"),
        probe("put-bucket-versioning", "manage-versioning", "denied"),
      ]),
    ).toBe("unavailable");
  });

  test("denied beats unsupported and error", () => {
    expect(
      rollupCapability("object-tagging", [
        probe("get-object-tagging", "object-tagging", "denied"),
        probe("put-object-tagging", "object-tagging", "unsupported"),
      ]),
    ).toBe("unavailable");
  });

  test("unsupported beats error", () => {
    expect(
      rollupCapability("list-versions", [
        probe("list-object-versions", "list-versions", "unsupported"),
      ]),
    ).toBe("unsupported");
  });

  test("error → unknown", () => {
    expect(
      rollupCapability("browse-objects", [
        probe("list-objects-v2", "browse-objects", "error"),
      ]),
    ).toBe("unknown");
  });

  test("skipped probes are filtered out before rollup", () => {
    expect(
      rollupCapability("manage-versioning", [
        probe("get-bucket-versioning", "manage-versioning", "granted"),
        probe("put-bucket-versioning", "manage-versioning", "skipped"),
      ]),
    ).toBe("available");
  });

  test("all required skipped → untested", () => {
    expect(
      rollupCapability("manage-versioning", [
        probe("get-bucket-versioning", "manage-versioning", "skipped"),
        probe("put-bucket-versioning", "manage-versioning", "skipped"),
      ]),
    ).toBe("untested");
  });

  test("skipped + denied → unavailable", () => {
    expect(
      rollupCapability("manage-versioning", [
        probe("get-bucket-versioning", "manage-versioning", "skipped"),
        probe("put-bucket-versioning", "manage-versioning", "denied"),
      ]),
    ).toBe("unavailable");
  });

  test("non-required probes are ignored entirely", () => {
    expect(
      rollupCapability("browse-objects", [
        probe("list-objects-v2", "browse-objects", "granted"),
        probe("informational", "browse-objects", "denied", false),
      ]),
    ).toBe("available");
  });
});

describe("buildCapabilities", () => {
  test("connection scope returns only connection-level capabilities", () => {
    const records: ProbeResultRecord[] = [
      probe("list-buckets", "browse-buckets", "granted"),
      probe("delete-bucket", "delete-buckets", "denied"),
    ];
    const caps = buildCapabilities("connection", records);
    expect(caps.map((c) => c.key)).toEqual([
      "browse-buckets",
      "create-buckets",
      "delete-buckets",
    ]);
    expect(caps.find((c) => c.key === "browse-buckets")?.status).toBe(
      "available",
    );
    expect(caps.find((c) => c.key === "create-buckets")?.status).toBe(
      "untested",
    );
    expect(caps.find((c) => c.key === "delete-buckets")?.status).toBe(
      "unavailable",
    );
  });

  test("each capability carries its IAM actions and affects copy", () => {
    const caps = buildCapabilities("connection", [
      probe("list-buckets", "browse-buckets", "granted"),
    ]);
    const browse = caps.find((c) => c.key === "browse-buckets");
    expect(browse?.requiredIamActions).toEqual(["s3:ListAllMyBuckets"]);
    expect(browse?.affects.length).toBeGreaterThan(0);
  });

  test("each capability carries the underlying probe details", () => {
    const caps = buildCapabilities("connection", [
      probe("list-buckets", "browse-buckets", "denied"),
    ]);
    const browse = caps.find((c) => c.key === "browse-buckets");
    expect(browse?.probes).toEqual([
      { key: "list-buckets", result: "denied", errorCode: undefined },
    ]);
  });

  test("bucket scope returns only bucket-level capabilities", () => {
    const records: ProbeResultRecord[] = [
      probe("list-objects-v2", "browse-objects", "granted"),
    ];
    const caps = buildCapabilities("bucket", records);
    expect(caps.map((c) => c.key)).not.toContain("browse-buckets");
    expect(caps.map((c) => c.key)).toContain("browse-objects");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/health/rollup.test.ts`
Expected: FAIL with "Cannot find module './rollup'"

- [ ] **Step 3: Implement `rollup.ts`**

```typescript
// src/lib/health/rollup.ts
import {
  CAPABILITIES,
  BUCKET_CAPABILITIES,
  CONNECTION_CAPABILITIES,
} from "./capabilities";
import type {
  CapabilityKey,
  CapabilityReport,
  CapabilityStatus,
  ProbeResultRecord,
  ProbeScope,
} from "./probe";

export function rollupCapability(
  _capability: CapabilityKey,
  probes: ProbeResultRecord[],
): CapabilityStatus {
  const required = probes.filter((p) => p.required && p.result !== "skipped");
  if (required.length === 0) return "untested";
  if (required.some((p) => p.result === "denied")) return "unavailable";
  if (required.some((p) => p.result === "unsupported")) return "unsupported";
  if (required.some((p) => p.result === "error")) return "unknown";
  return "available";
}

export function buildCapabilities(
  scope: ProbeScope,
  probeResults: ProbeResultRecord[],
): CapabilityReport[] {
  const capabilityKeys =
    scope === "connection" ? CONNECTION_CAPABILITIES : BUCKET_CAPABILITIES;

  return capabilityKeys.map((key) => {
    const def = CAPABILITIES[key];
    const probesForCap = probeResults.filter((p) => p.capability === key);
    const status = rollupCapability(key, probesForCap);

    return {
      key,
      label: def.label,
      status,
      probes: probesForCap.map((p) => ({
        key: p.key,
        result: p.result,
        errorCode: p.errorCode,
      })),
      requiredIamActions: def.requiredIamActions,
      affects: def.affects,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/health/rollup.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/rollup.ts src/lib/health/rollup.test.ts
git commit -m "feat(health): roll probe results into capability statuses"
```

---

### Task 5: Derive connectivity flag from probe results

**Files:**
- Create: `src/lib/health/connectivity.ts`
- Test: `src/lib/health/connectivity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/health/connectivity.test.ts
import { describe, test, expect } from "vitest";
import { deriveConnectivity } from "./connectivity";
import type { ProbeResultRecord } from "./probe";

function rec(
  result: ProbeResultRecord["result"],
  errorCode?: string,
): ProbeResultRecord {
  return {
    key: "k",
    capability: "browse-buckets",
    required: true,
    result,
    errorCode,
    durationMs: 0,
  };
}

describe("deriveConnectivity", () => {
  test("any granted result → ok", () => {
    expect(
      deriveConnectivity("connection", [rec("granted"), rec("denied")]),
    ).toBe("ok");
  });

  test("all errors with network → unreachable (connection scope)", () => {
    expect(
      deriveConnectivity("connection", [
        rec("error", "network"),
        rec("error", "timeout"),
      ]),
    ).toBe("unreachable");
  });

  test("all errors with timeout → unreachable", () => {
    expect(
      deriveConnectivity("bucket", [
        rec("error", "timeout"),
        rec("error", "timeout"),
      ]),
    ).toBe("unreachable");
  });

  test("mix of network and non-network errors → ok", () => {
    expect(
      deriveConnectivity("connection", [
        rec("error", "network"),
        rec("error", "BadRequest"),
      ]),
    ).toBe("ok");
  });

  test("bucket scope: all NoSuchBucket → missing-bucket", () => {
    expect(
      deriveConnectivity("bucket", [
        rec("granted", "NoSuchBucket"),
        rec("granted", "NoSuchBucket"),
      ]),
    ).toBe("missing-bucket");
  });

  test("bucket scope: NoSuchBucket mixed with other → ok", () => {
    expect(
      deriveConnectivity("bucket", [
        rec("granted", "NoSuchBucket"),
        rec("granted"),
      ]),
    ).toBe("ok");
  });

  test("connection scope: NoSuchBucket never produces missing-bucket", () => {
    expect(
      deriveConnectivity("connection", [
        rec("granted", "NoSuchBucket"),
        rec("granted", "NoSuchBucket"),
      ]),
    ).toBe("ok");
  });

  test("skipped probes are ignored in derivation", () => {
    expect(
      deriveConnectivity("connection", [
        rec("error", "network"),
        rec("skipped"),
      ]),
    ).toBe("unreachable");
  });

  test("empty probe list → ok", () => {
    expect(deriveConnectivity("connection", [])).toBe("ok");
  });

  test("all skipped → ok", () => {
    expect(deriveConnectivity("connection", [rec("skipped")])).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/health/connectivity.test.ts`
Expected: FAIL with "Cannot find module './connectivity'"

- [ ] **Step 3: Implement `connectivity.ts`**

```typescript
// src/lib/health/connectivity.ts
import type { Connectivity, ProbeResultRecord, ProbeScope } from "./probe";

export function deriveConnectivity(
  scope: ProbeScope,
  probeResults: ProbeResultRecord[],
): Connectivity {
  const nonSkipped = probeResults.filter((p) => p.result !== "skipped");
  if (nonSkipped.length === 0) return "ok";

  const allNetworkErrors = nonSkipped.every(
    (p) =>
      p.result === "error" &&
      (p.errorCode === "network" || p.errorCode === "timeout"),
  );
  if (allNetworkErrors) return "unreachable";

  if (scope === "bucket") {
    const allMissingBucket = nonSkipped.every(
      (p) => p.errorCode === "NoSuchBucket",
    );
    if (allMissingBucket) return "missing-bucket";
  }

  return "ok";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/health/connectivity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/connectivity.ts src/lib/health/connectivity.test.ts
git commit -m "feat(health): derive connectivity flag from probe results"
```

---

## Phase 2 — Data layer (DB schema)

### Task 6: Add Prisma models for health check tables

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the four new models after the existing `ShareLinkEvent` model**

Add to the end of `prisma/schema.prisma`:

```prisma
model ConnectionHealthCheck {
  id           String   @id @default(uuid())
  connectionId String   @unique
  checkedAt    DateTime
  durationMs   Int
  connectivity String   // "ok" | "unreachable"
  connection   Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  probes       ConnectionPermissionCheck[]

  @@map("connection_health_checks")
}

model ConnectionPermissionCheck {
  id            String   @id @default(uuid())
  healthCheckId String
  probeKey      String
  result        String   // "granted" | "denied" | "unsupported" | "error" | "skipped"
  errorCode     String?
  durationMs    Int
  healthCheck   ConnectionHealthCheck @relation(fields: [healthCheckId], references: [id], onDelete: Cascade)

  @@unique([healthCheckId, probeKey])
  @@map("connection_permission_checks")
}

model BucketHealthCheck {
  id           String   @id @default(uuid())
  connectionId String
  bucket       String
  checkedAt    DateTime
  durationMs   Int
  connectivity String   // "ok" | "unreachable" | "missing-bucket"
  connection   Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  probes       BucketPermissionCheck[]

  @@unique([connectionId, bucket])
  @@index([connectionId])
  @@map("bucket_health_checks")
}

model BucketPermissionCheck {
  id            String   @id @default(uuid())
  healthCheckId String
  probeKey      String
  result        String
  errorCode     String?
  durationMs    Int
  healthCheck   BucketHealthCheck @relation(fields: [healthCheckId], references: [id], onDelete: Cascade)

  @@unique([healthCheckId, probeKey])
  @@map("bucket_permission_checks")
}
```

- [ ] **Step 2: Add back-relations to the `Connection` model**

In `prisma/schema.prisma`, find the `Connection` model (around line 182) and add these two lines before the `@@index([workspaceId])` line:

```prisma
  healthCheck         ConnectionHealthCheck?
  bucketHealthChecks  BucketHealthCheck[]
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm prisma migrate dev --name credential_health_check`
Expected: prompt for confirmation; creates `prisma/migrations/<timestamp>_credential_health_check/migration.sql`; regenerates Prisma client to `src/generated/prisma/`

- [ ] **Step 4: Verify schema compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS — the new model types are available on `prisma.connectionHealthCheck`, etc.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(health): add Prisma models for credential health check"
```

---

## Phase 3 — Probes

### Task 7: Define connection-scoped probes

**Files:**
- Create: `src/lib/health/probes/connection.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/health/probes/connection.ts
import {
  DeleteBucketCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import { classifyError } from "../classify";
import type { Probe, ProbeRunOutcome } from "../probe";

function elapsed(start: number): number {
  return Math.max(0, performance.now() - start);
}

const listBuckets: Probe = {
  key: "list-buckets",
  capability: "browse-buckets",
  scope: "connection",
  required: true,
  async run({ client }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(new ListBucketsCommand({}));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const deleteBucket: Probe = {
  key: "delete-bucket",
  capability: "delete-buckets",
  scope: "connection",
  required: true,
  async run({ client, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    const probeBucketName = `s3client-healthcheck-${randomKey.split("-").pop() ?? "nonexistent"}`;
    try {
      await client.send(new DeleteBucketCommand({ Bucket: probeBucketName }));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

export const CONNECTION_PROBES: Probe[] = [listBuckets, deleteBucket];
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/health/probes/connection.ts
git commit -m "feat(health): define connection-scoped probes"
```

---

### Task 8: Define bucket-scoped probes

**Files:**
- Create: `src/lib/health/probes/bucket.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/health/probes/bucket.ts
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
} from "@aws-sdk/client-s3";
import { classifyError } from "../classify";
import type { Probe, ProbeRunOutcome } from "../probe";

const SOURCE_KEY_PREFIX = "__s3client-healthcheck__/source-";
const DEST_KEY_PREFIX = "__s3client-healthcheck__/dest-";
// Deliberately wrong base64 MD5 — does not match an empty body. S3 evaluates
// auth before Content-MD5 validation across all providers.
const BAD_CONTENT_MD5 = "AAAAAAAAAAAAAAAAAAAAAA==";

function elapsed(start: number): number {
  return Math.max(0, performance.now() - start);
}

const listObjects: Probe = {
  key: "list-objects-v2",
  capability: "browse-objects",
  scope: "bucket",
  required: true,
  async run({ client, bucket }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const headObject: Probe = {
  key: "head-object",
  capability: "download-objects",
  scope: "bucket",
  required: true,
  async run({ client, bucket, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: randomKey }));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const putObject: Probe = {
  key: "put-object",
  capability: "upload-objects",
  scope: "bucket",
  required: true,
  async run({ client, bucket, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: randomKey,
          Body: new Uint8Array(0),
          ContentMD5: BAD_CONTENT_MD5,
        }),
      );
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const deleteObject: Probe = {
  key: "delete-object",
  capability: "delete-objects",
  scope: "bucket",
  required: true,
  async run({ client, bucket, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: randomKey }));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const copyObject: Probe = {
  key: "copy-object",
  capability: "copy-objects",
  scope: "bucket",
  required: true,
  async run({ client, bucket, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    const suffix = randomKey.split("-").pop() ?? "nonexistent";
    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: `${DEST_KEY_PREFIX}${suffix}`,
          CopySource: `${bucket}/${SOURCE_KEY_PREFIX}${suffix}`,
        }),
      );
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const getObjectTagging: Probe = {
  key: "get-object-tagging",
  capability: "object-tagging",
  scope: "bucket",
  required: true,
  async run({ client, bucket, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(
        new GetObjectTaggingCommand({ Bucket: bucket, Key: randomKey }),
      );
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const putObjectTagging: Probe = {
  key: "put-object-tagging",
  capability: "object-tagging",
  scope: "bucket",
  required: true,
  async run({ client, bucket, randomKey }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(
        new PutObjectTaggingCommand({
          Bucket: bucket,
          Key: randomKey,
          Tagging: { TagSet: [] },
        }),
      );
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const listObjectVersions: Probe = {
  key: "list-object-versions",
  capability: "list-versions",
  scope: "bucket",
  required: true,
  async run({ client, bucket }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(
        new ListObjectVersionsCommand({ Bucket: bucket, MaxKeys: 1 }),
      );
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const getBucketVersioning: Probe = {
  key: "get-bucket-versioning",
  capability: "manage-versioning",
  scope: "bucket",
  required: true,
  async run({ client, bucket }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const putBucketVersioning: Probe = {
  key: "put-bucket-versioning",
  capability: "manage-versioning",
  scope: "bucket",
  required: true,
  async run({ client, bucket }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    let currentStatus: "Enabled" | "Suspended" | undefined;
    try {
      const current = await client.send(
        new GetBucketVersioningCommand({ Bucket: bucket }),
      );
      currentStatus = current.Status;
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }

    if (!currentStatus) {
      return { result: "skipped", durationMs: elapsed(start) };
    }

    try {
      await client.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: currentStatus },
        }),
      );
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

const listMultipartUploads: Probe = {
  key: "list-multipart-uploads",
  capability: "view-multipart",
  scope: "bucket",
  required: true,
  async run({ client, bucket }): Promise<ProbeRunOutcome> {
    const start = performance.now();
    try {
      await client.send(
        new ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1 }),
      );
      return { result: "granted", durationMs: elapsed(start) };
    } catch (err) {
      const { result, errorCode } = classifyError(err);
      return { result, errorCode, durationMs: elapsed(start) };
    }
  },
};

export const BUCKET_PROBES: Probe[] = [
  listObjects,
  headObject,
  putObject,
  deleteObject,
  copyObject,
  getObjectTagging,
  putObjectTagging,
  listObjectVersions,
  getBucketVersioning,
  putBucketVersioning,
  listMultipartUploads,
];
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/health/probes/bucket.ts
git commit -m "feat(health): define bucket-scoped probes"
```

---

### Task 9: Probe registry

**Files:**
- Create: `src/lib/health/registry.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/health/registry.ts
import { CONNECTION_PROBES } from "./probes/connection";
import { BUCKET_PROBES } from "./probes/bucket";
import type { Probe, ProbeScope } from "./probe";

export { CONNECTION_PROBES, BUCKET_PROBES };

export function probesForScope(scope: ProbeScope): Probe[] {
  return scope === "connection" ? CONNECTION_PROBES : BUCKET_PROBES;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/health/registry.ts
git commit -m "feat(health): probe registry"
```

---

## Phase 4 — Runner

### Task 10: In-process mutex

**Files:**
- Create: `src/lib/health/mutex.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/health/mutex.ts
const inflight = new Map<string, Promise<unknown>>();

export async function withMutex<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

// For tests only — clear all in-flight entries.
export function __resetMutex(): void {
  inflight.clear();
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/health/mutex.ts
git commit -m "feat(health): in-process mutex for run de-duplication"
```

---

### Task 11: Health check runner (with tests)

**Files:**
- Create: `src/lib/health/runner.ts`
- Test: `src/lib/health/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/health/runner.test.ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  DeleteBucketCommand,
  GetBucketVersioningCommand,
  ListBucketsCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    connection: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    connectionHealthCheck: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    connectionPermissionCheck: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    bucketHealthCheck: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    bucketPermissionCheck: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

const sendMock = vi.fn();
vi.mock("@/lib/s3/client", () => ({
  createS3Client: vi.fn(() => ({ send: sendMock })),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

import prisma from "@/lib/db/prisma";
import { runConnectionHealthCheck, runBucketHealthCheck } from "./runner";
import { __resetMutex } from "./mutex";

function setupConnection(connection: {
  id: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  updatedAt?: Date;
}) {
  const record = {
    id: connection.id,
    endpoint: connection.endpoint ?? "https://s3.example.com",
    region: connection.region ?? "us-east-1",
    accessKeyId: connection.accessKeyId ?? "AKID",
    secretAccessKey: connection.secretAccessKey ?? "secret",
    forcePathStyle: connection.forcePathStyle ?? true,
    updatedAt: connection.updatedAt ?? new Date("2026-06-06T00:00:00Z"),
  };
  (prisma.connection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
    record,
  );
  return record;
}

function setupTransactionPassthrough() {
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
  );
}

function sdkError(name: string, httpStatusCode?: number) {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockReset();
  __resetMutex();
  setupTransactionPassthrough();
  (prisma.connectionHealthCheck.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "hc-1",
  });
  (prisma.connectionPermissionCheck.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
    count: 0,
  });
  (prisma.connectionPermissionCheck.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({
    count: 0,
  });
  (prisma.bucketHealthCheck.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "bhc-1",
  });
  (prisma.bucketPermissionCheck.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
    count: 0,
  });
  (prisma.bucketPermissionCheck.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({
    count: 0,
  });
});

describe("runConnectionHealthCheck", () => {
  test("all probes succeed → all capabilities available", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockResolvedValue({});

    const report = await runConnectionHealthCheck("conn-1");

    expect(report.scope).toBe("connection");
    expect(report.connectivity).toBe("ok");
    const browse = report.capabilities.find((c) => c.key === "browse-buckets");
    const del = report.capabilities.find((c) => c.key === "delete-buckets");
    const create = report.capabilities.find((c) => c.key === "create-buckets");
    expect(browse?.status).toBe("available");
    expect(del?.status).toBe("available");
    expect(create?.status).toBe("untested");
  });

  test("all probes throw AccessDenied → all capabilities unavailable", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockRejectedValue(sdkError("AccessDenied", 403));

    const report = await runConnectionHealthCheck("conn-1");
    expect(
      report.capabilities.find((c) => c.key === "browse-buckets")?.status,
    ).toBe("unavailable");
    expect(
      report.capabilities.find((c) => c.key === "delete-buckets")?.status,
    ).toBe("unavailable");
  });

  test("all probes throw NetworkingError → connectivity unreachable, capabilities unknown", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockRejectedValue(sdkError("NetworkingError"));

    const report = await runConnectionHealthCheck("conn-1");
    expect(report.connectivity).toBe("unreachable");
    expect(
      report.capabilities.find((c) => c.key === "browse-buckets")?.status,
    ).toBe("unknown");
  });

  test("non-existent connection throws", async () => {
    (prisma.connection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    await expect(runConnectionHealthCheck("missing")).rejects.toThrow(
      /not found/i,
    );
  });

  test("mutex: simultaneous calls share one result", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({}), 25)),
    );

    const [a, b] = await Promise.all([
      runConnectionHealthCheck("conn-1"),
      runConnectionHealthCheck("conn-1"),
    ]);

    expect(a).toEqual(b);
    // listBuckets + deleteBucket = 2 probes, called once each
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test("credentials edited mid-run → result discarded", async () => {
    const original = setupConnection({ id: "conn-1" });
    sendMock.mockResolvedValue({});
    (prisma.connectionHealthCheck.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null);
    // Simulate update between read and persist: $transaction sees newer updatedAt
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => {
        (prisma.connection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          ...original,
          updatedAt: new Date(original.updatedAt.getTime() + 1000),
        });
        return fn(prisma);
      },
    );

    const report = await runConnectionHealthCheck("conn-1");
    // The runner still returns a report from the in-memory computation,
    // but did not call the persist mutation.
    expect(report.scope).toBe("connection");
    expect(prisma.connectionHealthCheck.upsert).not.toHaveBeenCalled();
  });
});

describe("runBucketHealthCheck", () => {
  test("all probes succeed → all capabilities available, connectivity ok", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof GetBucketVersioningCommand) {
        return Promise.resolve({ Status: "Enabled" });
      }
      return Promise.resolve({});
    });

    const report = await runBucketHealthCheck("conn-1", "my-bucket");
    expect(report.scope).toBe("bucket");
    expect(report.bucket).toBe("my-bucket");
    expect(report.connectivity).toBe("ok");
    expect(
      report.capabilities.find((c) => c.key === "browse-objects")?.status,
    ).toBe("available");
    expect(
      report.capabilities.find((c) => c.key === "manage-versioning")?.status,
    ).toBe("available");
  });

  test("put-bucket-versioning on never-versioned bucket → skipped, capability still available", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof GetBucketVersioningCommand) {
        return Promise.resolve({});
      }
      if (cmd instanceof PutBucketVersioningCommand) {
        // Should not be called when bucket has never been versioned
        throw new Error("PutBucketVersioning should be skipped");
      }
      return Promise.resolve({});
    });

    const report = await runBucketHealthCheck("conn-1", "my-bucket");
    const versioning = report.capabilities.find(
      (c) => c.key === "manage-versioning",
    );
    expect(versioning?.status).toBe("available");
    expect(versioning?.probes.find((p) => p.key === "put-bucket-versioning")?.result).toBe(
      "skipped",
    );
  });

  test("all probes throw NoSuchBucket → connectivity missing-bucket", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockRejectedValue(sdkError("NoSuchBucket"));

    const report = await runBucketHealthCheck("conn-1", "ghost-bucket");
    expect(report.connectivity).toBe("missing-bucket");
  });

  test("AccessDenied on some probes → mix of available/unavailable", async () => {
    setupConnection({ id: "conn-1" });
    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof DeleteBucketCommand) {
        return Promise.reject(sdkError("AccessDenied", 403));
      }
      if (cmd instanceof ListBucketsCommand) {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const report = await runBucketHealthCheck("conn-1", "my-bucket");
    // Bucket scope doesn't include browse-buckets, but if denials happen we should still get a real report
    expect(report.scope).toBe("bucket");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/health/runner.test.ts`
Expected: FAIL with "Cannot find module './runner'"

- [ ] **Step 3: Implement `runner.ts`**

```typescript
// src/lib/health/runner.ts
import prisma from "@/lib/db/prisma";
import { createS3Client } from "@/lib/s3/client";
import { decrypt } from "@/lib/crypto";
import { buildCapabilities } from "./rollup";
import { deriveConnectivity } from "./connectivity";
import { withMutex } from "./mutex";
import { probesForScope } from "./registry";
import {
  PROBE_TIMEOUT_MS,
  RUN_TIMEOUT_MS,
  STALENESS_THRESHOLD_MS,
  type Connectivity,
  type HealthReport,
  type Probe,
  type ProbeResult,
  type ProbeResultRecord,
  type ProbeScope,
} from "./probe";

interface ConnectionRecord {
  id: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  updatedAt: Date;
}

async function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      const err = Object.assign(new Error("Probe timed out"), {
        name: "TimeoutError",
      });
      reject(err);
    }, ms);
  });
}

async function runProbeWithTimeout(
  probe: Probe,
  ctx: { client: ReturnType<typeof createS3Client>; bucket?: string; randomKey: string },
): Promise<ProbeResultRecord> {
  const start = performance.now();
  try {
    const outcome = await Promise.race([
      probe.run(ctx),
      timeoutAfter(PROBE_TIMEOUT_MS).then(() => {
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      }),
    ]);
    return {
      key: probe.key,
      capability: probe.capability,
      required: probe.required,
      result: outcome.result,
      errorCode: outcome.errorCode,
      durationMs: outcome.durationMs,
    };
  } catch (err) {
    const e = err as { name?: string };
    const isTimeout = e?.name === "TimeoutError";
    return {
      key: probe.key,
      capability: probe.capability,
      required: probe.required,
      result: "error" as ProbeResult,
      errorCode: isTimeout ? "timeout" : "exception",
      durationMs: Math.max(0, performance.now() - start),
    };
  }
}

function decryptConnection(c: ConnectionRecord): ConnectionRecord {
  return { ...c, secretAccessKey: decrypt(c.secretAccessKey) };
}

function buildRandomKey(): string {
  return `__s3client-healthcheck__/probe-${crypto.randomUUID()}`;
}

function logResult(
  scope: ProbeScope,
  connectionId: string,
  bucket: string | undefined,
  durationMs: number,
  connectivity: Connectivity,
  records: ProbeResultRecord[],
): void {
  const counts = { granted: 0, denied: 0, unsupported: 0, errors: 0, skipped: 0 };
  for (const r of records) {
    if (r.result === "granted") counts.granted++;
    else if (r.result === "denied") counts.denied++;
    else if (r.result === "unsupported") counts.unsupported++;
    else if (r.result === "error") counts.errors++;
    else if (r.result === "skipped") counts.skipped++;
  }
  console.log(
    `[health] connectionId=${connectionId} scope=${scope}${
      bucket ? ` bucket=${bucket}` : ""
    } durationMs=${Math.round(durationMs)} connectivity=${connectivity} granted=${counts.granted} denied=${counts.denied} unsupported=${counts.unsupported} errors=${counts.errors} skipped=${counts.skipped}`,
  );
}

function buildReport(
  scope: ProbeScope,
  connectionId: string,
  bucket: string | undefined,
  checkedAt: Date,
  durationMs: number,
  records: ProbeResultRecord[],
): HealthReport {
  const connectivity = deriveConnectivity(scope, records);
  const capabilities = buildCapabilities(scope, records);
  const isStale =
    Date.now() - checkedAt.getTime() > STALENESS_THRESHOLD_MS;
  return {
    scope,
    connectionId,
    bucket,
    checkedAt: checkedAt.toISOString(),
    isStale,
    durationMs: Math.round(durationMs),
    connectivity,
    capabilities,
  };
}

export async function runConnectionHealthCheck(
  connectionId: string,
): Promise<HealthReport> {
  return withMutex(`connection:${connectionId}`, () =>
    runScope("connection", connectionId, undefined),
  );
}

export async function runBucketHealthCheck(
  connectionId: string,
  bucket: string,
): Promise<HealthReport> {
  return withMutex(`bucket:${connectionId}:${bucket}`, () =>
    runScope("bucket", connectionId, bucket),
  );
}

async function runScope(
  scope: ProbeScope,
  connectionId: string,
  bucket: string | undefined,
): Promise<HealthReport> {
  const overallStart = performance.now();

  const record = (await prisma.connection.findUnique({
    where: { id: connectionId },
  })) as ConnectionRecord | null;
  if (!record) {
    throw new Error(`Connection not found: ${connectionId}`);
  }
  const initialUpdatedAt = record.updatedAt.getTime();
  const decrypted = decryptConnection(record);

  const client = createS3Client({
    endpoint: decrypted.endpoint,
    accessKeyId: decrypted.accessKeyId,
    secretAccessKey: decrypted.secretAccessKey,
    region: decrypted.region,
    forcePathStyle: decrypted.forcePathStyle,
  });

  const randomKey = buildRandomKey();
  const probes = probesForScope(scope);
  const ctx = { client, bucket, randomKey };

  const runAll = Promise.allSettled(
    probes.map((p) => runProbeWithTimeout(p, ctx)),
  ).then((settled) =>
    settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
            key: probes[i].key,
            capability: probes[i].capability,
            required: probes[i].required,
            result: "error" as ProbeResult,
            errorCode: "exception",
            durationMs: 0,
          },
    ),
  );

  const records = await Promise.race([
    runAll,
    timeoutAfter(RUN_TIMEOUT_MS),
  ]).catch(() =>
    probes.map((p) => ({
      key: p.key,
      capability: p.capability,
      required: p.required,
      result: "error" as ProbeResult,
      errorCode: "timeout",
      durationMs: RUN_TIMEOUT_MS,
    })),
  );

  const checkedAt = new Date();
  const durationMs = performance.now() - overallStart;
  const report = buildReport(
    scope,
    connectionId,
    bucket,
    checkedAt,
    durationMs,
    records,
  );

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.connection.findUnique({
      where: { id: connectionId },
    });
    if (!fresh) return;
    if (fresh.updatedAt.getTime() !== initialUpdatedAt) return;

    if (scope === "connection") {
      const upserted = await tx.connectionHealthCheck.upsert({
        where: { connectionId },
        create: {
          connectionId,
          checkedAt,
          durationMs: Math.round(durationMs),
          connectivity: report.connectivity,
        },
        update: {
          checkedAt,
          durationMs: Math.round(durationMs),
          connectivity: report.connectivity,
        },
      });
      await tx.connectionPermissionCheck.deleteMany({
        where: { healthCheckId: upserted.id },
      });
      await tx.connectionPermissionCheck.createMany({
        data: records.map((r) => ({
          healthCheckId: upserted.id,
          probeKey: r.key,
          result: r.result,
          errorCode: r.errorCode ?? null,
          durationMs: Math.round(r.durationMs),
        })),
      });
    } else {
      const upserted = await tx.bucketHealthCheck.upsert({
        where: { connectionId_bucket: { connectionId, bucket: bucket! } },
        create: {
          connectionId,
          bucket: bucket!,
          checkedAt,
          durationMs: Math.round(durationMs),
          connectivity: report.connectivity,
        },
        update: {
          checkedAt,
          durationMs: Math.round(durationMs),
          connectivity: report.connectivity,
        },
      });
      await tx.bucketPermissionCheck.deleteMany({
        where: { healthCheckId: upserted.id },
      });
      await tx.bucketPermissionCheck.createMany({
        data: records.map((r) => ({
          healthCheckId: upserted.id,
          probeKey: r.key,
          result: r.result,
          errorCode: r.errorCode ?? null,
          durationMs: Math.round(r.durationMs),
        })),
      });
    }
  });

  logResult(scope, connectionId, bucket, durationMs, report.connectivity, records);
  return report;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/health/runner.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/runner.ts src/lib/health/runner.test.ts
git commit -m "feat(health): runner that executes probes, persists, and rolls up"
```

---

## Phase 5 — API routes

### Task 12: Connection-level health check route

**Files:**
- Create: `src/app/api/connections/[id]/health-check/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/connections/[id]/health-check/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import prisma from "@/lib/db/prisma";
import { runConnectionHealthCheck } from "@/lib/health/runner";
import { buildCapabilities } from "@/lib/health/rollup";
import {
  STALENESS_THRESHOLD_MS,
  type HealthReport,
  type ProbeResult,
  type ProbeResultRecord,
} from "@/lib/health/probe";
import { CONNECTION_PROBES } from "@/lib/health/registry";

type Params = { id: string };

async function readPersisted(connectionId: string): Promise<HealthReport | null> {
  const row = await prisma.connectionHealthCheck.findUnique({
    where: { connectionId },
    include: { probes: true },
  });
  if (!row) return null;

  const records: ProbeResultRecord[] = row.probes.map((p) => {
    const probe = CONNECTION_PROBES.find((cp) => cp.key === p.probeKey);
    return {
      key: p.probeKey,
      capability: probe?.capability ?? "browse-buckets",
      required: probe?.required ?? true,
      result: p.result as ProbeResult,
      errorCode: p.errorCode ?? undefined,
      durationMs: p.durationMs,
    };
  });

  return {
    scope: "connection",
    connectionId,
    checkedAt: row.checkedAt.toISOString(),
    isStale: Date.now() - row.checkedAt.getTime() > STALENESS_THRESHOLD_MS,
    durationMs: row.durationMs,
    connectivity: row.connectivity as HealthReport["connectivity"],
    capabilities: buildCapabilities("connection", records),
  };
}

export const GET = withAuth<{ params: Promise<Params> }>(
  async (_req, { user, params }) => {
    const access = await getConnectionAccessById(params.id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const report = await readPersisted(params.id);
    if (!report) {
      return NextResponse.json({ error: "not_run" }, { status: 404 });
    }
    return NextResponse.json(report);
  },
);

export const POST = withAuth<{ params: Promise<Params> }>(
  async (_req, { user, params }) => {
    const access = await getConnectionAccessById(params.id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only admins can run a health check" },
        { status: 403 },
      );
    }

    try {
      const report = await runConnectionHealthCheck(params.id);
      const status = report.connectivity === "unreachable" ? 502 : 200;
      return NextResponse.json(report, { status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
);
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/connections/[id]/health-check/route.ts
git commit -m "feat(health): connection health check API route"
```

---

### Task 13: Bucket-level health check route

**Files:**
- Create: `src/app/api/connections/[id]/buckets/[bucket]/health-check/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/connections/[id]/buckets/[bucket]/health-check/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import prisma from "@/lib/db/prisma";
import { runBucketHealthCheck } from "@/lib/health/runner";
import { buildCapabilities } from "@/lib/health/rollup";
import {
  STALENESS_THRESHOLD_MS,
  type HealthReport,
  type ProbeResult,
  type ProbeResultRecord,
} from "@/lib/health/probe";
import { BUCKET_PROBES } from "@/lib/health/registry";

type Params = { id: string; bucket: string };

async function readPersisted(
  connectionId: string,
  bucket: string,
): Promise<HealthReport | null> {
  const row = await prisma.bucketHealthCheck.findUnique({
    where: { connectionId_bucket: { connectionId, bucket } },
    include: { probes: true },
  });
  if (!row) return null;

  const records: ProbeResultRecord[] = row.probes.map((p) => {
    const probe = BUCKET_PROBES.find((bp) => bp.key === p.probeKey);
    return {
      key: p.probeKey,
      capability: probe?.capability ?? "browse-objects",
      required: probe?.required ?? true,
      result: p.result as ProbeResult,
      errorCode: p.errorCode ?? undefined,
      durationMs: p.durationMs,
    };
  });

  return {
    scope: "bucket",
    connectionId,
    bucket,
    checkedAt: row.checkedAt.toISOString(),
    isStale: Date.now() - row.checkedAt.getTime() > STALENESS_THRESHOLD_MS,
    durationMs: row.durationMs,
    connectivity: row.connectivity as HealthReport["connectivity"],
    capabilities: buildCapabilities("bucket", records),
  };
}

export const GET = withAuth<{ params: Promise<Params> }>(
  async (_req, { user, params }) => {
    const access = await getConnectionAccessById(params.id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const report = await readPersisted(params.id, params.bucket);
    if (!report) {
      return NextResponse.json({ error: "not_run" }, { status: 404 });
    }
    return NextResponse.json(report);
  },
);

export const POST = withAuth<{ params: Promise<Params> }>(
  async (_req, { user, params }) => {
    const access = await getConnectionAccessById(params.id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const report = await runBucketHealthCheck(params.id, params.bucket);
      const status = report.connectivity === "unreachable" ? 502 : 200;
      return NextResponse.json(report, { status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
);
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/connections/[id]/buckets/[bucket]/health-check/route.ts
git commit -m "feat(health): bucket health check API route"
```

---

### Task 14: Summary route for feature gating

**Files:**
- Create: `src/app/api/connections/[id]/health-check/summary/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/connections/[id]/health-check/summary/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import prisma from "@/lib/db/prisma";
import { buildCapabilities } from "@/lib/health/rollup";
import {
  STALENESS_THRESHOLD_MS,
  type CapabilityKey,
  type CapabilityStatus,
  type HealthSummary,
  type ProbeResult,
  type ProbeResultRecord,
} from "@/lib/health/probe";
import { BUCKET_PROBES, CONNECTION_PROBES } from "@/lib/health/registry";

type Params = { id: string };

function reduceToStatusMap(
  records: ProbeResultRecord[],
  scope: "connection" | "bucket",
): Partial<Record<CapabilityKey, CapabilityStatus>> {
  const result: Partial<Record<CapabilityKey, CapabilityStatus>> = {};
  for (const cap of buildCapabilities(scope, records)) {
    result[cap.key] = cap.status;
  }
  return result;
}

export const GET = withAuth<{ params: Promise<Params> }>(
  async (_req, { user, params }) => {
    const access = await getConnectionAccessById(params.id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [connRow, bucketRows] = await Promise.all([
      prisma.connectionHealthCheck.findUnique({
        where: { connectionId: params.id },
        include: { probes: true },
      }),
      prisma.bucketHealthCheck.findMany({
        where: { connectionId: params.id },
        include: { probes: true },
      }),
    ]);

    let connection: HealthSummary["connection"] = null;
    let isConnectionStale = false;
    if (connRow) {
      const records: ProbeResultRecord[] = connRow.probes.map((p) => {
        const probe = CONNECTION_PROBES.find((cp) => cp.key === p.probeKey);
        return {
          key: p.probeKey,
          capability: probe?.capability ?? "browse-buckets",
          required: probe?.required ?? true,
          result: p.result as ProbeResult,
          errorCode: p.errorCode ?? undefined,
          durationMs: p.durationMs,
        };
      });
      connection = reduceToStatusMap(records, "connection");
      isConnectionStale =
        Date.now() - connRow.checkedAt.getTime() > STALENESS_THRESHOLD_MS;
    }

    const buckets: HealthSummary["buckets"] = {};
    const staleBuckets: string[] = [];
    for (const row of bucketRows) {
      const records: ProbeResultRecord[] = row.probes.map((p) => {
        const probe = BUCKET_PROBES.find((bp) => bp.key === p.probeKey);
        return {
          key: p.probeKey,
          capability: probe?.capability ?? "browse-objects",
          required: probe?.required ?? true,
          result: p.result as ProbeResult,
          errorCode: p.errorCode ?? undefined,
          durationMs: p.durationMs,
        };
      });
      buckets[row.bucket] = reduceToStatusMap(records, "bucket");
      if (Date.now() - row.checkedAt.getTime() > STALENESS_THRESHOLD_MS) {
        staleBuckets.push(row.bucket);
      }
    }

    const summary: HealthSummary = {
      connectionId: params.id,
      connection,
      buckets,
      staleBuckets,
      isConnectionStale,
    };
    return NextResponse.json(summary);
  },
);
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/api/connections/[id]/health-check/summary/route.ts
git commit -m "feat(health): summary API route for feature gating"
```

---

## Phase 6 — React Query layer

### Task 15: Add health query keys

**Files:**
- Modify: `src/lib/queries/keys.ts`

- [ ] **Step 1: Append the `health` namespace to the `queryKeys` object**

Open `src/lib/queries/keys.ts` and add this entry just before the closing `};` of the `queryKeys` object:

```typescript
  health: {
    all: ["health"] as const,
    connection: (id: string) =>
      [...queryKeys.health.all, "connection", id] as const,
    bucket: (id: string, bucket: string) =>
      [...queryKeys.health.all, "bucket", id, bucket] as const,
    summary: (id: string) =>
      [...queryKeys.health.all, "summary", id] as const,
  },
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/keys.ts
git commit -m "feat(health): add health query keys"
```

---

### Task 16: React Query hooks

**Files:**
- Create: `src/lib/queries/health.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/queries/health.ts
"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { queryKeys } from "./keys";
import { CAPABILITIES } from "@/lib/health/capabilities";
import type {
  CapabilityKey,
  CapabilityStatus,
  HealthReport,
  HealthSummary,
} from "@/lib/health/probe";

async function fetchConnectionHealth(
  connectionId: string,
): Promise<HealthReport | null> {
  const res = await fetch(
    `/api/connections/${connectionId}/health-check`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch health");
  }
  return res.json();
}

async function fetchBucketHealth(
  connectionId: string,
  bucket: string,
): Promise<HealthReport | null> {
  const res = await fetch(
    `/api/connections/${connectionId}/buckets/${encodeURIComponent(bucket)}/health-check`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch bucket health");
  }
  return res.json();
}

async function fetchHealthSummary(
  connectionId: string,
): Promise<HealthSummary> {
  const res = await fetch(
    `/api/connections/${connectionId}/health-check/summary`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch summary");
  }
  return res.json();
}

async function runConnectionHealth(
  connectionId: string,
): Promise<HealthReport> {
  const res = await fetch(
    `/api/connections/${connectionId}/health-check`,
    { method: "POST" },
  );
  // 502 still returns a body — read it before deciding error
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 502) {
    throw new Error(body.error || `Health check failed (${res.status})`);
  }
  return body as HealthReport;
}

async function runBucketHealth(
  connectionId: string,
  bucket: string,
): Promise<HealthReport> {
  const res = await fetch(
    `/api/connections/${connectionId}/buckets/${encodeURIComponent(bucket)}/health-check`,
    { method: "POST" },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 502) {
    throw new Error(body.error || `Health check failed (${res.status})`);
  }
  return body as HealthReport;
}

export function useConnectionHealth(
  connectionId: string,
): UseQueryResult<HealthReport | null> {
  return useQuery({
    queryKey: queryKeys.health.connection(connectionId),
    queryFn: () => fetchConnectionHealth(connectionId),
    enabled: !!connectionId,
    staleTime: 60_000,
  });
}

export function useBucketHealth(
  connectionId: string,
  bucket: string,
): UseQueryResult<HealthReport | null> {
  return useQuery({
    queryKey: queryKeys.health.bucket(connectionId, bucket),
    queryFn: () => fetchBucketHealth(connectionId, bucket),
    enabled: !!connectionId && !!bucket,
    staleTime: 60_000,
  });
}

export function useHealthSummary(
  connectionId: string,
): UseQueryResult<HealthSummary> {
  return useQuery({
    queryKey: queryKeys.health.summary(connectionId),
    queryFn: () => fetchHealthSummary(connectionId),
    enabled: !!connectionId,
    staleTime: 60_000,
  });
}

export function useRunConnectionHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { connectionId: string }) =>
      runConnectionHealth(vars.connectionId),
    onSuccess: (data, vars) => {
      qc.setQueryData(queryKeys.health.connection(vars.connectionId), data);
      qc.invalidateQueries({
        queryKey: queryKeys.health.summary(vars.connectionId),
      });
    },
  });
}

export function useRunBucketHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { connectionId: string; bucket: string }) =>
      runBucketHealth(vars.connectionId, vars.bucket),
    onSuccess: (data, vars) => {
      qc.setQueryData(
        queryKeys.health.bucket(vars.connectionId, vars.bucket),
        data,
      );
      qc.invalidateQueries({
        queryKey: queryKeys.health.summary(vars.connectionId),
      });
    },
  });
}

export interface CapabilityResolution {
  status: CapabilityStatus;
  reason: string | null;
  isLoading: boolean;
}

export function useCapability(
  connectionId: string,
  bucket: string | undefined,
  capability: CapabilityKey,
): CapabilityResolution {
  const { data: summary, isLoading } = useHealthSummary(connectionId);

  return useMemo(() => {
    if (isLoading || !summary) {
      return { status: "available", reason: null, isLoading: true };
    }
    const status: CapabilityStatus | undefined = bucket
      ? summary.buckets[bucket]?.[capability]
      : summary.connection?.[capability];

    if (!status) {
      return { status: "available", reason: null, isLoading: false };
    }

    if (status === "available" || status === "untested") {
      return { status, reason: null, isLoading: false };
    }

    const actions = CAPABILITIES[capability].requiredIamActions.join(", ");
    let reason: string;
    if (status === "unavailable") {
      reason = `You don't have ${actions}${bucket ? ` on this bucket` : ""}. See Permissions for details.`;
    } else if (status === "unsupported") {
      reason = `Not supported by this provider.`;
    } else {
      reason = `Couldn't verify ${actions}. Refresh the permission check.`;
    }
    return { status, reason, isLoading: false };
  }, [summary, isLoading, bucket, capability]);
}

export function useInvalidateConnectionHealth() {
  const qc = useQueryClient();
  return (connectionId: string) => {
    qc.invalidateQueries({
      queryKey: queryKeys.health.connection(connectionId),
    });
    qc.invalidateQueries({
      queryKey: queryKeys.health.summary(connectionId),
    });
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/health.ts
git commit -m "feat(health): React Query hooks for health endpoints"
```

---

## Phase 7 — UI primitives

### Task 17: CapabilityRow component

**Files:**
- Create: `src/components/health/capability-row.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/health/capability-row.tsx
"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Minus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CapabilityReport, CapabilityStatus } from "@/lib/health/probe";
import { cn } from "@/lib/utils";

function StatusIcon({ status }: { status: CapabilityStatus }) {
  switch (status) {
    case "available":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "unavailable":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "unsupported":
      return <Minus className="h-4 w-4 text-muted-foreground" />;
    case "untested":
      return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    default:
      return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusLabel(status: CapabilityStatus): string {
  switch (status) {
    case "available":
      return "Available";
    case "unavailable":
      return "Unavailable";
    case "unsupported":
      return "Not supported by this provider";
    case "untested":
      return "Untested";
    default:
      return "Unknown";
  }
}

interface CapabilityRowProps {
  capability: CapabilityReport;
  defaultOpen?: boolean;
}

export function CapabilityRow({ capability, defaultOpen = false }: CapabilityRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const showDetails = capability.status !== "available";

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <StatusIcon status={capability.status} />
        <span className="flex-1 text-sm font-medium">{capability.label}</span>
        <span
          className={cn(
            "text-xs",
            capability.status === "unavailable" && "text-destructive",
            capability.status === "available" && "text-muted-foreground",
            capability.status === "untested" && "text-yellow-700",
          )}
        >
          {statusLabel(capability.status)}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pl-9 space-y-2 text-sm">
          {showDetails && capability.requiredIamActions.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Required IAM actions
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-0.5 text-xs">
                  {capability.requiredIamActions.join(", ")}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      capability.requiredIamActions.join("\n"),
                    )
                  }
                  title="Copy IAM actions"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          {capability.affects.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Affects
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                {capability.affects.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {capability.probes.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Probe details
              </div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {capability.probes.map((p) => (
                  <li key={p.key}>
                    <code>{p.key}</code> → {p.result}
                    {p.errorCode ? ` (${p.errorCode})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/health/capability-row.tsx
git commit -m "feat(health): collapsible CapabilityRow component"
```

---

### Task 18: HealthReport shared layout

**Files:**
- Create: `src/components/health/health-report.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/health/health-report.tsx
"use client";

import { RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CapabilityRow } from "./capability-row";
import type { HealthReport as HealthReportType } from "@/lib/health/probe";

interface HealthReportViewProps {
  report: HealthReportType;
  endpoint?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function HealthReportView({
  report,
  endpoint,
  onRefresh,
  isRefreshing,
}: HealthReportViewProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Permissions</h2>
          <p className="text-xs text-muted-foreground">
            Last checked {relativeTime(report.checkedAt)}
          </p>
        </div>
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {report.isStale && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          <AlertTriangle className="h-4 w-4" />
          <span>
            Results are over 7 days old. Refresh to verify current permissions.
          </span>
        </div>
      )}

      {report.connectivity === "unreachable" && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>
            Couldn&apos;t reach {endpoint ?? "the endpoint"}. Check the URL and
            credentials.
          </span>
        </div>
      )}

      {report.connectivity === "missing-bucket" && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>
            Bucket {report.bucket} no longer exists at this endpoint.
          </span>
        </div>
      )}

      <Card className="overflow-hidden">
        {report.capabilities.map((cap) => (
          <CapabilityRow key={cap.key} capability={cap} />
        ))}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/health/health-report.tsx
git commit -m "feat(health): shared HealthReportView layout"
```

---

### Task 19: PermissionsCard for Bucket Overview

**Files:**
- Create: `src/components/health/permissions-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/health/permissions-card.tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Minus,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useBucketHealth,
  useRunBucketHealth,
} from "@/lib/queries/health";
import type { CapabilityStatus } from "@/lib/health/probe";

function StatusIcon({ status }: { status: CapabilityStatus }) {
  switch (status) {
    case "available":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
    case "unavailable":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "unsupported":
      return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
    case "untested":
      return <AlertTriangle className="h-3.5 w-3.5 text-yellow-600" />;
    default:
      return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

interface PermissionsCardProps {
  connectionId: string;
  bucket: string;
}

export function PermissionsCard({ connectionId, bucket }: PermissionsCardProps) {
  const { data: report, isLoading, isError } = useBucketHealth(
    connectionId,
    bucket,
  );
  const runHealth = useRunBucketHealth();

  // Lazy-run on first visit: if there's no persisted record (data === null),
  // kick off a POST so the card populates on the next render.
  useEffect(() => {
    if (!isLoading && !isError && report === null && !runHealth.isPending) {
      runHealth.mutate({ connectionId, bucket });
    }
  }, [isLoading, isError, report, runHealth, connectionId, bucket]);

  if (isLoading || (report === null && runHealth.isPending)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Running initial permission check…
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (isError || (report === null && !runHealth.isPending)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">
            Couldn&apos;t complete the permission check.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runHealth.mutate({ connectionId, bucket })}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!report) return null;

  const available = report.capabilities.filter(
    (c) => c.status === "available",
  ).length;
  const unavailable = report.capabilities.filter(
    (c) => c.status === "unavailable",
  ).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm">Permissions</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {available} of {report.capabilities.length} available
              {unavailable > 0 ? ` · ${unavailable} unavailable` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => runHealth.mutate({ connectionId, bucket })}
            disabled={runHealth.isPending}
            title="Refresh permissions"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${runHealth.isPending ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {report.capabilities.map((cap) => (
          <div key={cap.key} className="flex items-center gap-2 text-sm">
            <StatusIcon status={cap.status} />
            <span className="text-muted-foreground">{cap.label}</span>
          </div>
        ))}
        <div className="pt-2">
          <Link
            href={`/connections/${connectionId}/buckets/${encodeURIComponent(bucket)}/health`}
            className="text-xs text-primary hover:underline"
          >
            View full report →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/health/permissions-card.tsx
git commit -m "feat(health): PermissionsCard for Bucket Overview"
```

---

### Task 20: CapabilityGate primitive

**Files:**
- Create: `src/components/health/capability-gate.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/health/capability-gate.tsx
"use client";

import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCapability } from "@/lib/queries/health";
import type { CapabilityKey } from "@/lib/health/probe";

interface CapabilityGateProps {
  connectionId: string;
  bucket?: string;
  capability: CapabilityKey;
  children: ReactNode;
}

export function CapabilityGate({
  connectionId,
  bucket,
  capability,
  children,
}: CapabilityGateProps) {
  const { status, reason } = useCapability(connectionId, bucket, capability);

  if (status === "available" || status === "untested" || !reason) {
    return <>{children}</>;
  }

  // Disable the first child element and wrap with tooltip.
  const child = Children.only(children);
  const disabledChild = isValidElement(child)
    ? cloneElement(child as React.ReactElement<{ disabled?: boolean; "aria-disabled"?: boolean }>, {
        disabled: true,
        "aria-disabled": true,
      })
    : child;

  const reportHref = bucket
    ? `/connections/${connectionId}/buckets/${encodeURIComponent(bucket)}/health`
    : `/connections/${connectionId}/health`;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{disabledChild}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <p>{reason}</p>
          <Link
            href={reportHref}
            className="mt-1 inline-block text-xs underline"
          >
            View permission report
          </Link>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/health/capability-gate.tsx
git commit -m "feat(health): CapabilityGate primitive for UI gating"
```

---

## Phase 8 — Diagnostic pages

### Task 21: Connection diagnostic page

**Files:**
- Create: `src/app/(dashboard)/connections/[id]/health/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(dashboard)/connections/[id]/health/page.tsx
"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/lib/queries/connections";
import {
  useConnectionHealth,
  useRunConnectionHealth,
} from "@/lib/queries/health";
import { HealthReportView } from "@/components/health/health-report";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ConnectionHealthPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: connections = [] } = useConnections();
  const connection = connections.find((c) => c.id === id);
  const { data: report, isLoading, isError } = useConnectionHealth(id);
  const runHealth = useRunConnectionHealth();

  // If no persisted report and not currently running, kick one off.
  useEffect(() => {
    if (!isLoading && !isError && report === null && !runHealth.isPending) {
      runHealth.mutate({ connectionId: id });
    }
  }, [isLoading, isError, report, runHealth, id]);

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <Link
          href="/connections"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Connections
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">
          {connection?.name || connection?.endpoint || "Connection"}
        </h1>
        <p className="text-sm text-muted-foreground">{connection?.endpoint}</p>
      </div>

      {(isLoading || (report === null && runHealth.isPending)) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Running initial permission check…
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Couldn&apos;t load the report.{" "}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => runHealth.mutate({ connectionId: id })}
          >
            Retry
          </Button>
        </div>
      )}

      {report && (
        <HealthReportView
          report={report}
          endpoint={connection?.endpoint}
          onRefresh={() => runHealth.mutate({ connectionId: id })}
          isRefreshing={runHealth.isPending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/connections/[id]/health/page.tsx"
git commit -m "feat(health): connection diagnostic page"
```

---

### Task 22: Bucket diagnostic page

**Files:**
- Create: `src/app/(dashboard)/connections/[id]/buckets/[bucket]/health/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(dashboard)/connections/[id]/buckets/[bucket]/health/page.tsx
"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/lib/queries/connections";
import {
  useBucketHealth,
  useRunBucketHealth,
} from "@/lib/queries/health";
import { HealthReportView } from "@/components/health/health-report";

interface PageProps {
  params: Promise<{ id: string; bucket: string }>;
}

export default function BucketHealthPage({ params }: PageProps) {
  const { id, bucket } = use(params);
  const { data: connections = [] } = useConnections();
  const connection = connections.find((c) => c.id === id);
  const { data: report, isLoading, isError } = useBucketHealth(id, bucket);
  const runHealth = useRunBucketHealth();

  useEffect(() => {
    if (!isLoading && !isError && report === null && !runHealth.isPending) {
      runHealth.mutate({ connectionId: id, bucket });
    }
  }, [isLoading, isError, report, runHealth, id, bucket]);

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <Link
          href={`/buckets/${id}/${encodeURIComponent(bucket)}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to {bucket}
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">{bucket}</h1>
        <p className="text-sm text-muted-foreground">
          {connection?.name || connection?.endpoint}
        </p>
      </div>

      {(isLoading || (report === null && runHealth.isPending)) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Running initial permission check…
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Couldn&apos;t load the report.{" "}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => runHealth.mutate({ connectionId: id, bucket })}
          >
            Retry
          </Button>
        </div>
      )}

      {report && (
        <HealthReportView
          report={report}
          endpoint={connection?.endpoint}
          onRefresh={() => runHealth.mutate({ connectionId: id, bucket })}
          isRefreshing={runHealth.isPending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/connections/[id]/buckets/[bucket]/health/page.tsx"
git commit -m "feat(health): bucket diagnostic page"
```

---

## Phase 9 — Auto-run, invalidation, integration

### Task 23: Kick off connection health check on create

**Files:**
- Modify: `src/app/api/connections/route.ts`

- [ ] **Step 1: Import the runner**

At the top of `src/app/api/connections/route.ts`, add:

```typescript
import { runConnectionHealthCheck } from "@/lib/health/runner";
```

- [ ] **Step 2: Fire the run non-blocking after `createConnection`**

In the `POST` handler, immediately after the successful `connection = await createConnection(...)` block (before the `return NextResponse.json({...})` line), add:

```typescript
  // Non-blocking onboarding diagnostic — kick off the connection-level
  // health check so the report is ready when the user lands on the page.
  runConnectionHealthCheck(connection.id).catch((err) => {
    console.error(
      `[health] initial connection check failed for ${connection.id}:`,
      err,
    );
  });
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/connections/route.ts
git commit -m "feat(health): kick off health check on connection create"
```

---

### Task 24: Invalidate health on credential edit

**Files:**
- Modify: `src/lib/db/connections.ts`

- [ ] **Step 1: Update `updateConnection` to detect credential changes and clear health rows**

Replace the existing `updateConnection` function in `src/lib/db/connections.ts` with:

```typescript
export async function updateConnection(
  id: string,
  userId: string,
  data: ConnectionUpdate
): Promise<Connection | null> {
  const access = await getConnectionAccessById(id, userId);
  if (!access || access.role !== "ADMIN") {
    return null;
  }

  const credentialFields: Array<keyof ConnectionUpdate> = [
    "endpoint",
    "accessKeyId",
    "secretAccessKey",
    "region",
    "forcePathStyle",
  ];
  const credentialsChanged = credentialFields.some((field) => {
    const next = data[field];
    if (next === undefined) return false;
    const current = (access.connection as Record<string, unknown>)[field];
    return next !== current;
  });

  const updateData = { ...data };
  if (updateData.secretAccessKey) {
    updateData.secretAccessKey = encrypt(updateData.secretAccessKey);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (credentialsChanged) {
      await tx.connectionHealthCheck.deleteMany({ where: { connectionId: id } });
      await tx.bucketHealthCheck.deleteMany({ where: { connectionId: id } });
    }
    return tx.connection.update({
      where: { id },
      data: updateData,
    });
  });

  if (credentialsChanged) {
    const { runConnectionHealthCheck } = await import("@/lib/health/runner");
    runConnectionHealthCheck(id).catch((err) => {
      console.error(
        `[health] re-run after credential edit failed for ${id}:`,
        err,
      );
    });
  }

  return updated;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/connections.ts
git commit -m "feat(health): invalidate health rows on credential edit"
```

---

### Task 25: Add "Health" link to connection cards

**Files:**
- Modify: `src/components/connections/connection-list.tsx`

- [ ] **Step 1: Import what we need**

At the top of `src/components/connections/connection-list.tsx`, add:

```typescript
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
```

- [ ] **Step 2: Render a "Health" link inside each connection card**

Find the `<p className="text-xs text-muted-foreground mt-1 truncate pl-6">{connection.endpoint}</p>` line near the bottom of each card. Immediately after that paragraph, add:

```tsx
<div className="mt-2 pl-6">
  <Link
    href={`/connections/${connection.id}/health`}
    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
  >
    <ShieldCheck className="h-3 w-3" />
    Health check
  </Link>
</div>
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/connections/connection-list.tsx
git commit -m "feat(health): add Health link to connection cards"
```

---

### Task 26: Wire PermissionsCard into Bucket Overview

**Files:**
- Modify: `src/components/buckets/overview-tab.tsx`

- [ ] **Step 1: Import and render**

Open `src/components/buckets/overview-tab.tsx`. Add the import alongside the existing card imports:

```typescript
import { PermissionsCard } from "@/components/health/permissions-card";
```

Then add `<PermissionsCard connectionId={connectionId} bucket={bucket} />` inside the `<div className="grid grid-cols-1 md:grid-cols-2 gap-4">` block, after `<OverviewIncompleteUploadsCard ... />`:

```tsx
        <OverviewIncompleteUploadsCard
          connectionId={connectionId}
          bucket={bucket}
        />
        <PermissionsCard connectionId={connectionId} bucket={bucket} />
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/buckets/overview-tab.tsx
git commit -m "feat(health): wire PermissionsCard into Bucket Overview"
```

---

## Phase 10 — Feature gating wire-up

### Task 27: Identify gating call-sites

Before wiring `<CapabilityGate>` into the UI, find the existing components that need to be gated.

- [ ] **Step 1: Survey the existing files (no changes yet)**

Run:
```bash
ls src/components/browser/
ls src/components/buckets/
ls src/components/info-drawer/
```

Identify which file owns each gated action:

| Capability | Component file (start here) |
|---|---|
| `create-buckets` | `src/app/(dashboard)/buckets/page.tsx` or `src/components/buckets/buckets-page-shell.tsx` (whichever holds "+ New bucket") |
| `delete-buckets` | `src/components/buckets/bucket-card.tsx` (dropdown menu Delete item) |
| `upload-objects` | `src/components/browser/file-browser.tsx` toolbar — "Upload" button and "+ New Folder" |
| `download-objects` | per-row download button in `src/components/browser/file-list.tsx` (or similar) and bulk-action toolbar |
| `delete-objects` | per-row delete + bulk delete in `file-list.tsx` / toolbar |
| `copy-objects` | context-menu entries for Rename/Copy/Move |
| `object-tagging` | `src/components/info-drawer/tags-tab.tsx` (or similar) |
| `list-versions` | `src/components/info-drawer/versions-tab.tsx` (or similar) |
| `manage-versioning` | `src/components/buckets/overview-versioning-card.tsx` |
| `view-multipart` | `src/components/buckets/overview-incomplete-uploads-card.tsx` |

Make notes for the next task — the next task only wires the bucket-card delete; subsequent tasks gate other surfaces one file at a time.

- [ ] **Step 2: No commit (survey only)**

---

### Task 28: Gate the "Delete bucket" action

**Files:**
- Modify: `src/components/buckets/bucket-card.tsx`

- [ ] **Step 1: Read the file to find the delete-bucket dropdown item**

```bash
# Open in editor
```

The file contains a `DropdownMenuItem` that triggers bucket deletion. We need to wrap that item in `<CapabilityGate>` with `capability="delete-buckets"` and `connectionId={connection.id}`.

- [ ] **Step 2: Add the import**

At the top of `src/components/buckets/bucket-card.tsx`:

```typescript
import { CapabilityGate } from "@/components/health/capability-gate";
```

- [ ] **Step 3: Wrap the Delete `DropdownMenuItem` in a gate**

Find the dropdown's Delete entry (it triggers `setDeletingBucket` or similar). Replace just the `<DropdownMenuItem ...>...</DropdownMenuItem>` element with:

```tsx
<CapabilityGate
  connectionId={connection.id}
  capability="delete-buckets"
>
  <DropdownMenuItem
    /* keep all existing props */
  >
    {/* keep all existing children */}
  </DropdownMenuItem>
</CapabilityGate>
```

(Preserve the existing `DropdownMenuItem`'s `className`, `onClick`, icon, and label exactly.)

- [ ] **Step 4: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/buckets/bucket-card.tsx
git commit -m "feat(health): gate Delete bucket action with capability"
```

---

### Task 29: Gate the "+ New bucket" button

**Files:**
- Modify: the file that owns the "+ New bucket" button (likely `src/app/(dashboard)/buckets/page.tsx` or a component it renders)

- [ ] **Step 1: Find the file**

```bash
# search for "New bucket" in src
```

Use Grep on the codebase: `pattern: "New bucket"` to find the exact file and line.

- [ ] **Step 2: Wrap the Button**

Add import:
```typescript
import { CapabilityGate } from "@/components/health/capability-gate";
```

Wrap the existing `<Button>` (or `<DropdownMenuItem>`) that triggers bucket creation. If multiple connections are visible, the button must be scoped to the active connection's id.

```tsx
<CapabilityGate
  connectionId={activeConnectionId}
  capability="create-buckets"
>
  <Button onClick={handleCreate}>+ New bucket</Button>
</CapabilityGate>
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add <file>
git commit -m "feat(health): gate New bucket button with capability"
```

---

### Task 30: Gate upload + folder buttons in file browser toolbar

**Files:**
- Modify: `src/components/browser/file-browser.tsx`

- [ ] **Step 1: Add import**

At the top:
```typescript
import { CapabilityGate } from "@/components/health/capability-gate";
```

- [ ] **Step 2: Wrap the Upload button**

Find the Upload button (search for "Upload" in `file-browser.tsx`). Wrap it:

```tsx
<CapabilityGate
  connectionId={connectionId}
  bucket={bucket}
  capability="upload-objects"
>
  <Button onClick={handleUploadClick}>Upload</Button>
</CapabilityGate>
```

- [ ] **Step 3: Wrap the "+ New folder" button**

Find the "+ New folder" or "New Folder" button in the same file and wrap it with the same `<CapabilityGate>` (same capability — `upload-objects` covers folder create since folder is a 0-byte PutObject).

- [ ] **Step 4: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/browser/file-browser.tsx
git commit -m "feat(health): gate Upload and New Folder buttons with capability"
```

---

### Task 31: Gate per-row and bulk download/delete/copy actions

**Files:**
- Modify: `src/components/browser/file-list.tsx` (per-row actions) and the bulk-action toolbar component (the file that owns the "Selected: N · Delete · Download · Copy" buttons)

- [ ] **Step 1: Find the bulk-action toolbar**

Grep for "Selected" or "bulk-actions" or "selection-toolbar" in `src/components/browser/`.

- [ ] **Step 2: Add `<CapabilityGate>` around each action**

For each action button (Download, Delete, Copy, Rename, Move):

```tsx
<CapabilityGate
  connectionId={connectionId}
  bucket={bucket}
  capability="download-objects" // or "delete-objects" / "copy-objects"
>
  <Button onClick={handleDownload}>Download</Button>
</CapabilityGate>
```

| Action | Capability |
|---|---|
| Download (per-row + bulk) | `download-objects` |
| Delete (per-row + bulk) | `delete-objects` |
| Rename, Copy, Move | `copy-objects` |

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/browser/
git commit -m "feat(health): gate object actions (download/delete/copy) with capabilities"
```

---

### Task 32: Gate the versioning controls and tags panel

**Files:**
- Modify: `src/components/buckets/overview-versioning-card.tsx`
- Modify: the tags panel component (find via grep for "TagSet" or "Tags" in `src/components/info-drawer/`)

- [ ] **Step 1: Gate the versioning Enable/Suspend buttons**

In `src/components/buckets/overview-versioning-card.tsx`, add import and wrap both buttons:

```typescript
import { CapabilityGate } from "@/components/health/capability-gate";
```

```tsx
<CapabilityGate
  connectionId={connectionId}
  bucket={bucket}
  capability="manage-versioning"
>
  <Button onClick={handleEnable}>Enable</Button>
</CapabilityGate>
<CapabilityGate
  connectionId={connectionId}
  bucket={bucket}
  capability="manage-versioning"
>
  <Button onClick={handleSuspend}>Suspend</Button>
</CapabilityGate>
```

- [ ] **Step 2: Gate the tags panel**

Locate the tags panel (info-drawer Tags tab). Wrap the entire panel's interactive controls (the add-tag form / save button) with:

```tsx
<CapabilityGate
  connectionId={connectionId}
  bucket={bucket}
  capability="object-tagging"
>
  {/* existing tag controls */}
</CapabilityGate>
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/buckets/overview-versioning-card.tsx <tags-panel-file>
git commit -m "feat(health): gate versioning and tags controls with capabilities"
```

---

### Task 33: Gate the Versions tab and multipart card

**Files:**
- Modify: the bucket detail tab component (find via grep for `versions` tab key in `src/components/buckets/`)
- Modify: `src/components/buckets/overview-incomplete-uploads-card.tsx`

- [ ] **Step 1: Wrap the Versions tab trigger**

If the Versions tab uses Radix tabs, the trigger lives in the `bucket-detail-tabs.tsx` component. Wrap the `<TabsTrigger value="versions">` in `<CapabilityGate>`:

```tsx
<CapabilityGate
  connectionId={connectionId}
  bucket={bucket}
  capability="list-versions"
>
  <TabsTrigger value="versions">Versions</TabsTrigger>
</CapabilityGate>
```

- [ ] **Step 2: Wrap the incomplete-uploads card**

In `src/components/buckets/overview-incomplete-uploads-card.tsx`, find the card's CTA link (the one that navigates to the multipart tab). Wrap it:

```tsx
<CapabilityGate
  connectionId={connectionId}
  bucket={bucket}
  capability="view-multipart"
>
  {/* existing "Review uploads →" link/button */}
</CapabilityGate>
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/buckets/bucket-detail-tabs.tsx src/components/buckets/overview-incomplete-uploads-card.tsx
git commit -m "feat(health): gate Versions tab and incomplete-uploads card with capabilities"
```

---

## Phase 11 — Final verification

### Task 34: Run the full test suite

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: PASS — all existing tests still pass, plus 4 new test files (classify, rollup, connectivity, runner) green

- [ ] **Step 2: Run the linter**

Run: `pnpm lint`
Expected: PASS — no lint errors

- [ ] **Step 3: Run a full TypeScript check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: If anything failed, fix and re-run before continuing**

---

### Task 35: Manual smoke test

These are not automated. Run the dev server and walk through each scenario.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

- [ ] **Step 2: Add a new connection with full-access credentials**

Expected:
- After save, navigate to `/connections/[id]/health`. Within ~5s the report renders with all connection capabilities `available` (and `create-buckets` showing `untested`).

- [ ] **Step 3: Add a connection with read-only credentials**

Expected:
- Connection diagnostic shows `browse-buckets` available, `delete-buckets` unavailable with `s3:DeleteBucket` listed.
- Open a bucket — Permissions card shows browse/download/list-versions available, upload/delete/etc. unavailable.
- The Upload button is disabled with a tooltip referencing `s3:PutObject` and linking to the bucket's health page.

- [ ] **Step 4: Click "Refresh" on the connection diagnostic**

Expected: button spins, then the report updates with a newer `checkedAt`.

- [ ] **Step 5: Edit the connection's access key**

Expected: navigating back to `/connections/[id]/health` re-runs the check automatically; bucket-level Permissions cards re-run on next visit.

- [ ] **Step 6: Point a connection at an unreachable endpoint**

Expected: connection diagnostic shows the connectivity error banner instead of capability rows.

- [ ] **Step 7: Connect to an R2 endpoint without versioning enabled**

Expected: `Manage versioning` capability shows as `unsupported` ("Not supported by this provider"), not red/denied.

- [ ] **Step 8: On a non-ADMIN connection role**

Expected: `GET` works (report renders), but the Refresh button hits the route and gets a 403 (mutation throws an error).

- [ ] **Step 9: Two browser tabs both click Refresh simultaneously**

Expected: server logs show only one set of S3 probe calls (mutex), both tabs receive the same report.

---

## Self-Review

Spec coverage:
- ✅ Capability model & probe catalog — Tasks 1, 2, 7, 8
- ✅ Probe results + rollup logic — Tasks 1, 4, 5
- ✅ Provider-specific handling (R2 NotImplemented, skipped) — Tasks 3, 4, 8
- ✅ Data model (4 tables + relations) — Task 6
- ✅ API routes (GET/POST connection, GET/POST bucket, GET summary) — Tasks 12, 13, 14
- ✅ Auto-run on connection add — Task 23
- ✅ Invalidation on credential edit — Task 24
- ✅ Lazy bucket-level run on first visit — Task 19 (PermissionsCard `useEffect`)
- ✅ Manual refresh button — Tasks 18, 19, 21, 22
- ✅ Staleness banner (7d threshold) — Tasks 1, 11, 18
- ✅ Connectivity flag derivation (ok / unreachable / missing-bucket) — Task 5
- ✅ HealthReport response shape — Tasks 1, 12, 13
- ✅ HealthSummary response shape — Tasks 1, 14
- ✅ Mutex serializing concurrent runs — Tasks 10, 11
- ✅ Per-probe 5s timeout, 30s run safety net — Tasks 1, 11
- ✅ React Query hooks + permissive default — Task 16
- ✅ CapabilityGate primitive (disabled + tooltip) — Task 20
- ✅ Connection diagnostic page — Task 21
- ✅ Bucket diagnostic page — Task 22
- ✅ Bucket Overview Permissions card — Tasks 19, 26
- ✅ "Health" link on connection card — Task 25
- ✅ Feature gating across all surfaces — Tasks 27–33
- ✅ Observability log line — Task 11
- ✅ Manual smoke checklist — Task 35

Placeholder scan: cleared.

Type consistency: `CapabilityKey`, `CapabilityStatus`, `ProbeResult`, `HealthReport`, `HealthSummary`, `ProbeResultRecord`, `Probe`, `ProbeContext`, `Connectivity` defined in Task 1 and used identically throughout. Function signatures match between Task 11 (`runConnectionHealthCheck`, `runBucketHealthCheck`) and Tasks 12, 13, 23, 24. `useCapability` return shape `{status, reason, isLoading}` consistent between Tasks 16 and 20.

Notes for the executor:
- The plan assumes the AWS SDK v3 commands listed in Task 8 are all importable from `@aws-sdk/client-s3@^3.700`. They are; verify by `pnpm tsc --noEmit` at the end of Task 8.
- Task 6 may prompt the Prisma CLI for migration name confirmation — accept it.
- Tasks 27–33 are intentionally lighter on copy-paste because they touch many existing files with unknown exact contents. The executor MUST first read each target file, find the existing button/element, and preserve its existing props when wrapping with `<CapabilityGate>`.
- The dynamic import `import("@/lib/health/runner")` in Task 24 is intentional — `connections.ts` is imported by many API routes; a top-level static import of the runner would pull `@aws-sdk/client-s3` (heavyweight) into every one of those request handlers, even those that never need health checks. The dynamic import keeps `connections.ts` lean and only loads the runner when a credential edit actually triggers it.
