# Plan 018: Standardize S3 `CopySource` construction on one shared, AWS-correct helper

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8d46baa..HEAD -- src/lib/s3/metadata.ts src/lib/s3/metadata.test.ts src/app/api/objects/rename/route.ts src/app/api/objects/copy/route.ts src/app/api/objects/move/route.ts src/app/api/objects/versions/copy/route.ts src/app/api/objects/versions/restore/route.ts src/lib/health/probes/bucket.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independent of plans 001–016)
- **Category**: bug / tech-debt
- **Planned at**: commit `8d46baa`, 2026-06-21

## Why this matters

This codebase builds the S3 `CopySource` parameter (the `x-amz-copy-source`
header used by `CopyObjectCommand`) **three different ways**, and they
disagree on how the bucket/key separator and in-key slashes get encoded:

1. **Whole-string encoded** — `encodeURIComponent(\`${bucket}/${key}\`)`.
   This encodes *everything*, including the `/` that separates the bucket
   name from the object key, turning `my-bucket/docs/file.txt` into
   `my-bucket%2Fdocs%2Ffile.txt`. Used in 6 places: metadata edit, copy,
   and move/rename.
2. **Key-only encoded** — `\`${bucket}/${encodeURIComponent(key)}\``. The
   bucket/key separator stays literal; only the key is encoded. This is the
   form AWS documents for `x-amz-copy-source`, and it is what this repo's
   **versioned** copy/restore routes already use — code that is shipped and
   working.
3. **Raw** — `\`${bucket}/${key}\`` with no encoding (health probe; works
   only because that key is a fixed ASCII string).

The whole-string form (#1) is non-standard: AWS's own documentation shows the
bucket/key separator as a literal slash with only the key URL-encoded. Having
both #1 and #2 in the same repo means future copy code will be cargo-culted
from whichever site a developer happens to read, and the #1 form is a
plausible source of silent `CopyObject` failures for keys containing spaces,
non-ASCII characters, or nested paths against stricter S3 implementations.

This plan introduces **one** helper, `buildCopySource()`, routes every
`CopySource` construction through it, and standardizes on form #2 — the form
this repo already proves works in its versioned routes. The win: one correct
implementation, one place to test, no encoding drift.

> **Honest scope note for the reviewer**: This is primarily a
> *consistency/correctness-hardening* change, not a confirmed live bug fix.
> The whole-string form may well work against AWS S3 today (S3 URL-decodes the
> copy-source header), which is why move/copy/rename have not been reported
> broken. We standardize onto the form the repo's versioned routes already use
> because it is the AWS-documented, lower-risk form — we are *not* claiming the
> old form is definitively broken. See STOP conditions for the live-S3 caveat.

## Current state

The `CopySource` construction sites, verified at commit `8d46baa`:

- `src/lib/s3/metadata.ts:67` — `buildMetadataCopyParams()` core helper:
  ```ts
  CopySource: encodeURIComponent(`${bucket}/${key}`),
  ```
- `src/app/api/objects/rename/route.ts:58` — single-file rename (copy-then-delete):
  ```ts
  CopySource: encodeURIComponent(`${bucket}/${sourceKey}`),
  ```
- `src/app/api/objects/copy/route.ts:194` — `copySingleObject()` (same-endpoint branch):
  ```ts
  CopySource: encodeURIComponent(`${sourceBucket}/${sourceKey}`),
  ```
- `src/app/api/objects/copy/route.ts:273` — `copyFolder()` (same-endpoint branch):
  ```ts
  CopySource: encodeURIComponent(`${sourceBucket}/${obj.Key}`),
  ```
- `src/app/api/objects/move/route.ts:242` — `moveSingleObject()` (same-endpoint branch):
  ```ts
  CopySource: encodeURIComponent(`${sourceBucket}/${sourceKey}`),
  ```
- `src/app/api/objects/move/route.ts:322` — `moveFolder()` (same-endpoint branch):
  ```ts
  CopySource: encodeURIComponent(`${sourceBucket}/${obj.Key}`),
  ```

The **already-correct** sites (the target pattern — refactor these onto the
helper too so there is exactly one implementation; the helper must produce
**byte-identical** output for these):

- `src/app/api/objects/versions/copy/route.ts:76`:
  ```ts
  CopySource: `${bucket}/${encodeURIComponent(key)}?versionId=${encodeURIComponent(versionId)}`,
  ```
- `src/app/api/objects/versions/restore/route.ts:43`:
  ```ts
  CopySource: `${bucket}/${encodeURIComponent(key)}?versionId=${encodeURIComponent(versionId)}`,
  ```

The **raw** site (route it through the helper for consistency; output changes
from `prefix/suffix` to `prefix/encodeURIComponent(suffix)`, which is safe
because the key is a fixed ASCII string with no characters that
`encodeURIComponent` alters):

- `src/lib/health/probes/bucket.ts:117`:
  ```ts
  CopySource: `${bucket}/${SOURCE_KEY_PREFIX}${suffix}`,
  ```

The **existing test that codifies the old form** and must be updated:

- `src/lib/s3/metadata.test.ts:36`:
  ```ts
  expect(params.CopySource).toBe(encodeURIComponent("my-bucket/docs/file.txt"));
  ```

### Repo conventions to match

- **Test framework is vitest**, co-located `*.test.ts` files. Model the new
  helper test on the existing `src/lib/s3/metadata.test.ts` (same
  `describe`/`test`/`expect` style, no mocking needed for a pure function).
- **Shared S3 helpers live in `src/lib/s3/`** (e.g. `src/lib/s3/metadata.ts`,
  `src/lib/s3/client.ts`). The new helper belongs there.
- Two-space indentation, double-quoted strings, named exports.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Tests (all) | `pnpm test`                              | all pass            |
| Tests (focused) | `npx vitest run src/lib/s3`          | all pass            |
| Typecheck | `npx tsc --noEmit`                         | see note below      |
| Lint      | `pnpm lint`                                | see note below      |

> **Pre-existing baseline noise — do NOT try to fix these, they are not yours:**
> At commit `8d46baa`, `npx tsc --noEmit` already reports **2 errors**, both
> in `src/components/landing/landing-page.test.tsx` (unused `@ts-expect-error`
> directives), and `pnpm lint` already reports **27 problems**. None are in
> this plan's scope. Your gate is: **tsc reports the same 2 pre-existing errors
> and no new ones**, and **lint reports no new problems** in the files you
> touched. If tsc error count rises above 2 or new lint errors appear in your
> files, you introduced them.

## Scope

**In scope** (the only files you should modify or create):

- `src/lib/s3/copy-source.ts` — **create** (the helper)
- `src/lib/s3/copy-source.test.ts` — **create** (helper unit tests)
- `src/lib/s3/metadata.ts` — replace the `CopySource:` line
- `src/lib/s3/metadata.test.ts` — update the one assertion at line 36
- `src/app/api/objects/rename/route.ts` — replace the `CopySource:` line + import
- `src/app/api/objects/copy/route.ts` — replace 2 `CopySource:` lines + import
- `src/app/api/objects/move/route.ts` — replace 2 `CopySource:` lines + import
- `src/app/api/objects/versions/copy/route.ts` — replace the `CopySource:` line + import
- `src/app/api/objects/versions/restore/route.ts` — replace the `CopySource:` line + import
- `src/lib/health/probes/bucket.ts` — replace the `CopySource:` line + import

**Out of scope** (do NOT touch, even though they look related):

- The cross-endpoint copy/move branches that stream via `GetObjectCommand` +
  `Upload` (e.g. `copy/route.ts:197-220`, `move/route.ts:245-268`) — they do
  **not** use `CopySource` at all. Leave them exactly as-is.
- The `MetadataDirective`, `StorageClass`, SSE, and metadata-validation logic
  in `src/lib/s3/metadata.ts` — only the one `CopySource:` line changes.
- Partial-failure handling in rename/move (orphaned source if delete fails)
  and unchecked `DeleteObjectsCommand` results — these are real but separate
  follow-ups, listed under "Optional follow-on hardening" below. Do **not**
  fold them into the core scope; they have their own verification.
- The pre-existing tsc/lint baseline noise (plan 003 owns that).

## Git workflow

- Branch: `advisor/018-standardize-copysource-encoding`
- Commit style is conventional commits (recent history: `fix(properties-drawer): …`,
  `refactor(info-drawer): …`). Example for this work:
  `refactor(s3): centralize CopySource construction in one helper`.
- Do **not** push or open a PR unless the operator instructs it.

## Steps

### Step 1: Create the shared helper

Create `src/lib/s3/copy-source.ts`:

```ts
/**
 * Builds the value for an S3 CopyObject `CopySource` parameter
 * (the `x-amz-copy-source` header).
 *
 * Format: `${bucket}/${encodeURIComponent(key)}`, optionally with a
 * `?versionId=...` suffix. The bucket/key separator slash is kept LITERAL;
 * only the key (and versionId) are URL-encoded. This matches the
 * AWS-documented form and the behavior of the versioned copy/restore routes.
 * The AWS SDK passes CopySource through verbatim (no additional encoding),
 * so callers must encode here.
 */
export function buildCopySource(
  bucket: string,
  key: string,
  versionId?: string
): string {
  const base = `${bucket}/${encodeURIComponent(key)}`;
  return versionId
    ? `${base}?versionId=${encodeURIComponent(versionId)}`
    : base;
}
```

**Verify**: `npx tsc --noEmit` → still exactly the 2 pre-existing
`landing-page.test.tsx` errors, no new errors.

### Step 2: Write the helper's unit test

Create `src/lib/s3/copy-source.test.ts`, modeled on
`src/lib/s3/metadata.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { buildCopySource } from "./copy-source";

describe("buildCopySource", () => {
  test("encodes the key but keeps the bucket/key separator literal", () => {
    expect(buildCopySource("my-bucket", "file.txt")).toBe("my-bucket/file.txt");
  });

  test("encodes in-key slashes for nested keys", () => {
    expect(buildCopySource("my-bucket", "docs/sub/file.txt")).toBe(
      "my-bucket/docs%2Fsub%2Ffile.txt"
    );
  });

  test("encodes spaces and special characters in the key", () => {
    expect(buildCopySource("b", "a b+c&d.txt")).toBe("b/a%20b%2Bc%26d.txt");
  });

  test("appends an encoded versionId when provided", () => {
    expect(buildCopySource("b", "k/v.txt", "abc 123")).toBe(
      "b/k%2Fv.txt?versionId=abc%20123"
    );
  });

  test("matches the form the versioned routes were already using", () => {
    const bucket = "b";
    const key = "docs/file.txt";
    const versionId = "v1";
    expect(buildCopySource(bucket, key, versionId)).toBe(
      `${bucket}/${encodeURIComponent(key)}?versionId=${encodeURIComponent(versionId)}`
    );
  });
});
```

**Verify**: `npx vitest run src/lib/s3/copy-source.test.ts` → all 5 tests pass.

### Step 3: Route `metadata.ts` through the helper

In `src/lib/s3/metadata.ts`:
- Add the import near the other imports at the top:
  `import { buildCopySource } from "./copy-source";`
- Replace line 67:
  ```ts
  CopySource: encodeURIComponent(`${bucket}/${key}`),
  ```
  with:
  ```ts
  CopySource: buildCopySource(bucket, key),
  ```

Then update the assertion in `src/lib/s3/metadata.test.ts:36` from:
```ts
expect(params.CopySource).toBe(encodeURIComponent("my-bucket/docs/file.txt"));
```
to:
```ts
expect(params.CopySource).toBe("my-bucket/docs%2Ffile.txt");
```

**Verify**: `npx vitest run src/lib/s3` → all pass (metadata + copy-source suites).

### Step 4: Route the rename/copy/move routes through the helper

For each file, add `import { buildCopySource } from "@/lib/s3/copy-source";`
(match the existing `@/lib/...` import style in that file) and replace the
`CopySource:` lines:

- `src/app/api/objects/rename/route.ts:58` →
  `CopySource: buildCopySource(bucket, sourceKey),`
- `src/app/api/objects/copy/route.ts:194` →
  `CopySource: buildCopySource(sourceBucket, sourceKey),`
- `src/app/api/objects/copy/route.ts:273` →
  `CopySource: buildCopySource(sourceBucket, obj.Key),`
- `src/app/api/objects/move/route.ts:242` →
  `CopySource: buildCopySource(sourceBucket, sourceKey),`
- `src/app/api/objects/move/route.ts:322` →
  `CopySource: buildCopySource(sourceBucket, obj.Key),`

> Note: at `copy/route.ts:273` and `move/route.ts:322`, `obj.Key` is typed
> `string | undefined`, but both sites are guarded by an `if (!obj.Key) continue;`
> earlier in the loop, so `obj.Key` is `string` here. If tsc complains about
> `string | undefined`, that means the guard moved — treat it as a STOP
> condition rather than adding a `!` assertion.

**Verify**: `npx tsc --noEmit` → still exactly the 2 pre-existing errors, no new ones.

### Step 5: Route the versioned routes through the helper (no behavior change)

These already produce the correct output; routing them through the helper
makes the implementation singular. Add the import and replace:

- `src/app/api/objects/versions/copy/route.ts:76` →
  `CopySource: buildCopySource(bucket, key, versionId),`
- `src/app/api/objects/versions/restore/route.ts:43` →
  `CopySource: buildCopySource(bucket, key, versionId),`

The helper output is byte-identical to the previous inline expressions, so no
test should change.

**Verify**: `pnpm test` → all pass (no version-route test regressions).

### Step 6: Route the health probe through the helper

In `src/lib/health/probes/bucket.ts`, add the import and replace line 117:
```ts
CopySource: `${bucket}/${SOURCE_KEY_PREFIX}${suffix}`,
```
with:
```ts
CopySource: buildCopySource(bucket, `${SOURCE_KEY_PREFIX}${suffix}`),
```

`SOURCE_KEY_PREFIX` + `suffix` is a fixed ASCII string containing no
characters `encodeURIComponent` alters, so the emitted header is unchanged.

**Verify**:
- `pnpm test` → all pass.
- `grep -rn "CopySource: encodeURIComponent" src/` → **no matches**.
- `grep -rn "CopySource:" src/ | grep -v "buildCopySource"` → **no matches**
  (every construction site now goes through the helper; the only remaining
  hit, the helper's own file, builds the string internally and has no
  `CopySource:` literal).

## Test plan

- **New file** `src/lib/s3/copy-source.test.ts` — 5 tests (Step 2): simple key,
  nested key (slash encoding), spaces/special chars, versionId variant, and an
  equivalence check against the versioned-route formula.
- **Updated** `src/lib/s3/metadata.test.ts:36` — assertion now expects the
  standardized `my-bucket/docs%2Ffile.txt` form (Step 3).
- Structural pattern to follow: `src/lib/s3/metadata.test.ts` (pure-function
  unit tests, no S3 mocking).
- **Verification**: `pnpm test` → all pass, including the 5 new
  `copy-source` tests; total test count rises by 5 (from 469 to 474).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src/lib/s3/copy-source.ts` and `src/lib/s3/copy-source.test.ts` exist.
- [ ] `pnpm test` exits 0; the 5 new `copy-source` tests pass; total tests = 474.
- [ ] `npx tsc --noEmit` reports **exactly the 2 pre-existing** `landing-page.test.tsx`
      errors and **no new** errors.
- [ ] `pnpm lint` reports **no new** problems in the touched files
      (count stays at the pre-existing 27 or lower).
- [ ] `grep -rn "CopySource: encodeURIComponent" src/` → no matches.
- [ ] `grep -rn "CopySource:" src/ | grep -v "buildCopySource"` → no matches.
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for 018 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at any "Current state" location doesn't match the excerpt (the
  codebase drifted since this plan was written at `8d46baa`).
- `npx tsc --noEmit` reports a `string | undefined` error at `copy/route.ts`
  or `move/route.ts` after Step 4 — it means the `if (!obj.Key) continue;`
  guard moved and the call is no longer provably safe.
- The new-vs-old `CopySource` output for the versioned routes (Step 5) is
  **not** byte-identical (a version-route test fails) — the helper signature
  is wrong; do not "fix" it by changing the test.
- You have access to a real S3 / MinIO endpoint and observe that an
  **existing, previously-working** same-endpoint copy/move/rename of a
  top-level (no-slash) key **starts failing** after this change. That would
  mean this S3 implementation needs the whole-string-encoded form — surface it
  instead of forcing the change. (Not expected; the versioned routes already
  use the new form successfully.)

## Maintenance notes

- **Any new `CopyObjectCommand` must call `buildCopySource()`** — never
  hand-roll the `CopySource` string again. A reviewer should reject inline
  `encodeURIComponent(\`${bucket}/${key}\`)` in future copy code.
- If cross-region/cross-account copies via access points are ever added, the
  `CopySource` format differs (ARN-based) — `buildCopySource()` would need a
  variant; don't silently pass an access-point ARN through the current helper.
- **Deferred, not done here** (separate follow-ups, intentionally out of scope):
  1. **Partial-failure in rename/move**: `rename/route.ts` does `CopyObject`
     then `DeleteObject`; if the delete throws, the route returns 500 while the
     copy already landed → an orphaned duplicate. `move/route.ts:128-141`
     batch-deletes after copies; a failed batch delete throws after copies
     landed. Consider compensating cleanup or a clearer partial-success response.
  2. **Unchecked `DeleteObjectsCommand` result**: `move/route.ts:139` discards
     the command output; S3 can return per-object `Errors` in `Deleted`/`Errors`
     while the HTTP call still succeeds, so partial delete failures are silent.
     Consider inspecting `result.Errors` and surfacing them.
  These were vetted as real but low-severity; promote them to their own plan
  only if orphaned-object reports appear in practice.
