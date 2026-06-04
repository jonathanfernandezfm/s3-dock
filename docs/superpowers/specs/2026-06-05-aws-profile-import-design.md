# AWS profile import — design

**Status:** approved
**Author:** Jonathan Fernandez Mertanen
**Date:** 2026-06-05

## Problem

Users coming from the AWS CLI already have their credentials configured in `~/.aws/credentials` and `~/.aws/config`. Re-entering each one through the manual "New connection" form is friction — especially for teams who routinely work across many accounts. The goal is a one-shot import that turns existing AWS profiles into S3-client connections.

## Scope

**In scope**

- Importing AWS profiles whose credentials are static `aws_access_key_id` / `aws_secret_access_key` pairs.
- Parsing both `~/.aws/credentials` (bare `[name]` headers) and `~/.aws/config` (`[profile name]` headers).
- Detecting role-chained and SSO profiles and surfacing them as "not supported" so users understand why they were skipped.
- Validating each profile's credentials against AWS S3 (`ListBuckets`) before persistence.
- Persisting valid profiles as `Connection` rows in the user's selected workspace, reusing the existing encrypted-at-rest storage path.

**Out of scope (deferred)**

- SSO / IAM Identity Center OAuth device flow.
- AssumeRole / role chains (`role_arn` + `source_profile`).
- Session-token credentials (treated as unsupported because they expire).
- Importing into non-AWS endpoints (MinIO, R2, Wasabi, …). The manual form continues to handle those.
- Re-import / refresh of an already-imported profile.

## User flow

1. On the Connections page, the user clicks a new **"Import from AWS profile"** button next to "New connection."
2. A modal opens. The user picks `~/.aws/credentials` and optionally `~/.aws/config` via file inputs. Files are read with `FileReader` and parsed in-browser.
3. Step 2 lists every profile detected, grouped by kind. Static-credential profiles are checked by default and have an editable connection-name field. Role-chained, SSO, and otherwise-unsupported profiles are listed but disabled, with a one-line reason.
4. The user picks a workspace (defaulting to the current one), adjusts names if desired, and clicks **"Import N profiles."**
5. The client POSTs the selected profiles to `/api/connections/import`. The server validates each one in parallel (`ListBuckets`), persists the valid ones, and returns per-row status.
6. Step 3 renders the result table — ✓ saved / ✗ invalid with a short error label per row. Clicking **Done** closes the modal; the connections list re-renders with the new rows.

## Architecture

```
~/.aws/credentials (uploaded)   ┐
                                ├─► browser: INI parse ─► ParsedProfile[]
~/.aws/config       (uploaded)  ┘                          │
                                                           ▼
                       user multi-selects + tweaks connection names
                                                           │
                                                           ▼
                       POST /api/connections/import { workspaceId, profiles[] }
                                                           │
                                                           ▼
                       server: parallel ListBuckets per profile (Promise.allSettled)
                                                           │
                                                           ▼
                       insert valid profiles into Connection (existing schema, encrypted)
                                                           │
                                                           ▼
                       respond with per-profile { saved | invalid }
                                                           │
                                                           ▼
                       client renders results; invalidates React Query cache
```

Files never leave the browser unparsed. The server only receives the four DB-bound fields per profile.

## Data model

**No schema changes.** The existing `Connection` model already holds every field an imported profile needs:

- `name` ← user-editable, defaults to the AWS profile name
- `endpoint` ← hardcoded `https://s3.amazonaws.com` for AWS imports
- `region` ← from `config` (or `us-east-1` fallback)
- `accessKeyId`, `secretAccessKey` ← from `credentials`, encrypted via `src/lib/crypto.ts` before insert
- `forcePathStyle` ← `false` (AWS S3 uses virtual-host style)
- `workspaceId` ← user-selected in step 2

Imported profiles silently coexist with same-named existing connections; the schema has no uniqueness constraint on `(workspaceId, name)` and we are not adding one here.

## Components

### `src/lib/aws/parse-profiles.ts` (new, ~80 LOC)

Pure INI parser. No external dependency — the AWS config format is small enough to handle in-house and avoiding the dep keeps the surface tight.

```ts
type ParsedProfile =
  | { kind: "static"; name: string; region: string; accessKeyId: string; secretAccessKey: string }
  | { kind: "role-chain"; name: string; reason: string }
  | { kind: "sso"; name: string; reason: string }
  | { kind: "unsupported"; name: string; reason: string };

export function parseAwsProfiles(input: {
  credentials?: string;
  config?: string;
}): ParsedProfile[];
```

Rules:
- `[default]` and `[name]` headers in `credentials` are profile sections; `[profile name]` (and bare `[default]`) headers in `config` are profile sections; `[sso-session X]` and `[services X]` headers in `config` are *not* profiles.
- `#` and `;` start comments; blank lines and surrounding whitespace are ignored.
- A profile appearing in both files is merged — `credentials` wins for keys, `config` wins for `region`.
- Classification (in order):
  - `role_arn` + `source_profile` present → `role-chain`.
  - `sso_session` or `sso_start_url` present → `sso`.
  - `aws_session_token` present → `unsupported`, reason `"session-token credentials aren't supported (they expire)"`.
  - `aws_access_key_id` + `aws_secret_access_key` present → `static`.
  - Otherwise → `unsupported`, reason describing the missing field.

### `src/components/connections/import-aws-profile-dialog.tsx` (new)

Modal component. State managed via a single `useReducer` to express the three-step flow cleanly:

```ts
type State =
  | { step: "upload"; credentials?: string; config?: string; parseError?: string }
  | { step: "select"; profiles: ParsedProfile[]; selection: Map<string, { selected: boolean; name: string }>; workspaceId: string }
  | { step: "importing"; payload: ImportRequest }
  | { step: "results"; results: ImportResult[] };
```

- **Upload step:** two file inputs (credentials required, config optional). On change, `FileReader.readAsText` populates state and triggers an immediate parse so format errors surface before the user clicks Next.
- **Select step:** workspace dropdown limited to workspaces where the caller has ADMIN role (defaults to current if eligible; disabled if there's only one eligible workspace); profile table with checkboxes; per-row editable connection-name input (prefilled, required, trimmed). Role-chain / SSO / other-unsupported rows are rendered but disabled with their `reason` shown.
- **Importing step:** spinner with "Validating N profiles…" label. Single POST.
- **Results step:** same table layout, status column replaces checkbox; ✓ saved / ✗ `<error>` per row.

Closing the modal at any point discards state — no draft persistence.

### `src/app/api/connections/import/route.ts` (new)

`POST` handler, wrapped in `withAuth`.

Request:
```ts
{
  workspaceId: string;
  profiles: Array<{
    name: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  }>;
}
```

Response:
```ts
{
  results: Array<{
    name: string;
    status: "saved" | "invalid";
    connectionId?: string;
    error?: string;
  }>;
}
```

Logic:

1. Zod-validate the body. Reject empty profile lists with 400.
2. Verify the caller has ADMIN role in `workspaceId`. 403 otherwise.
3. For each profile, in parallel via `Promise.allSettled`:
   - Build a transient `S3Client` (endpoint `https://s3.amazonaws.com`, region from the profile, `forcePathStyle: false`). No DB write yet.
   - Run `ListBucketsCommand`. On success the profile is valid; on error map the SDK error code to a short label (`InvalidAccessKeyId`, `SignatureDoesNotMatch`, `AccessDenied`, `NetworkError`, or `Unknown`).
4. For each valid profile, encrypt the secret via `src/lib/crypto.ts` and `prisma.connection.create`. Capture the returned `id` as `connectionId` in the result.
5. Return the assembled `results` array.

### `src/components/connections/connection-list.tsx` (modified)

Add an "Import from AWS profile" secondary button next to the existing "New connection" button. Visible only if the user has at least one workspace they're ADMIN in (mirrors the existing permission gating).

### `src/lib/queries/connections.ts` (modified)

Add a `useImportAwsProfiles` mutation that posts to `/api/connections/import` and invalidates the `connections` query key on success.

## Edge cases

| Case | Behaviour |
|---|---|
| No credentials file picked | "Next" disabled. Helper text under the file input. |
| Malformed INI | Inline error under the offending file input. Stay on step 1. |
| 0 profiles found | Step 2 shows "No profiles found." with a Back button. |
| Every profile unsupported | All rows greyed-out with reasons. Import button disabled. Footer: "Only profiles with `aws_access_key_id` and `aws_secret_access_key` can be imported right now." |
| Profile in both `credentials` and `config` | Merged in the parser: keys from `credentials`, `region` from `config`. Single row in step 2. |
| Access key without secret | `unsupported`, reason `"missing secret access key"`. |
| Empty connection-name in step 2 | Inline validation; block import until non-empty after trim. |
| Caller not ADMIN of target workspace | Server 403; modal shows toast. Selections preserved so they can switch workspaces. |
| Network error mid-import | Step-3 rows all marked `"Failed — network error"`, Retry button re-POSTs the same payload. |
| One profile times out, others succeed | Per-row error in results; successful profiles still saved. (Implicit in `Promise.allSettled` + per-row response.) |
| User closes modal during in-flight POST | Server-side work continues; client state lost. On reopening, saved rows appear in the connections list. |
| File > 1 MB | Client-side rejection: "File too large — AWS config files are normally under 100 KB." |
| User cancels before clicking Import | Parsed profiles live only in React state; closing the modal drops them. Secrets never persist. |
| `aws_session_token` present | `unsupported`, reason `"session-token credentials aren't supported (they expire)"`. |
| Workspace deleted between steps 1 and 3 | Server 404 → generic error in modal. Rare; no special handling. |

## Security

- Files are read locally with `FileReader`; raw file bodies never go over the wire.
- Secrets transit over HTTPS only — same posture as the existing manual create endpoint.
- The import endpoint reuses `src/lib/crypto.ts` for AES-256-GCM encryption before DB insert. It must not roll its own encryption.
- ADMIN-role check on the target workspace mirrors the existing connection-create endpoint.

## Testing

**Unit — INI parser.** Highest-value tests; the parser is pure and has all the awkward edges. Cover:

- `[default]` vs `[profile X]` headers.
- `[sso-session X]` / `[services X]` headers correctly *not* picked up as profiles.
- Comments (`#`, `;`), blank lines, surrounding whitespace.
- Profile in both files — merge rule.
- Access key without secret → `unsupported`.
- `aws_session_token` → `unsupported` with the right `reason`.
- `role_arn` + `source_profile` → `role-chain`.
- Realistic snapshot fixture: a multi-profile config copied from a real setup.

**Unit — import API route.** Mock `S3Client` to return success / `InvalidAccessKeyId` / `AccessDenied` / network error per profile. Assert:

- Per-row result mapping is correct.
- Only successful profiles result in DB inserts (Prisma mock).
- The encrypt helper is called with the secret before insert.
- 403 when caller is not ADMIN in the target workspace.

**Manual smoke test (golden path).**

1. `pnpm dev`, log in.
2. Click "Import from AWS profile" on the Connections page.
3. Upload a real (or sanitised) `~/.aws/credentials`.
4. Verify step 2 shows the right profiles and role-chain ones are disabled.
5. Click Import. Verify step 3 shows ✓ / ✗ per row.
6. Close modal. Confirm the new connections appear and can list buckets in the file browser.

**Out of scope for now.** Playwright E2E — overkill for a single modal until connection flows are automated more broadly.

## Open questions

None at design time. Decisions resolved during brainstorming:

- Import source → file upload of `~/.aws/credentials` and `~/.aws/config`.
- AssumeRole chains → out of scope (static creds only).
- Validation → test all on import, save valid ones, show per-row status.
- UX placement → standalone modal launched from the Connections page.
