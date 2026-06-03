# Smart Share Links — Design

**Date:** 2026-06-04
**Scope:** New feature. Adds a wrapped-presigned-URL sharing system to S3 Dock.

## Problem

Today, users share S3 objects by generating raw presigned URLs (`/api/objects/presign-batch`). These URLs work but are fire-and-forget:

- Cannot be revoked once shared (must rotate IAM keys)
- No password protection — anyone with the link gets the file
- No access tracking — no idea if the recipient ever opened it
- Look like phishing (200-char URL with `X-Amz-Signature=...`)
- Capped at the IAM session limit (typically 7 days)

A DevOps team handing build artifacts, logs, or backups to vendors, contractors, or non-AWS internal teammates hits this workflow ~20×/day. Each instance is a small papercut and a small audit-trail gap.

## Decision

Add **share links**: a server-owned wrapper around presigned URLs that turns one-click "share this file" into a tracked, controllable link with a branded landing page.

Public surface lives at `<host>/s/<slug>`. When a recipient opens it, the server validates the link (not revoked / not expired / not exhausted / password OK), then redirects to a fresh 60-second presigned URL. Bandwidth stays on the customer's S3 (their cost, not ours).

## Scope — v1

**In:** single-file shares with expiry, soft-revoke, optional password gate, optional download cap, access analytics, branded landing page with inline preview for known file types.

**Out (deferred to v2):** folder shares, upload links, custom domains, custom accent color / logo, OG image route, CAPTCHA, IP allowlists, webhook events, QR codes, Redis-backed rate limiter, tier gating, audit export, email notifications on access.

## Locked design decisions

| # | Decision | Value |
|---|---|---|
| 1 | Serving strategy | Always redirect to a fresh 60s presigned URL. No proxy. |
| 2 | Slug shape | 8-char base62 random. No custom slugs. |
| 3 | Ownership model | Workspace-owned (any workspace member can view/revoke any link). Creator recorded for audit. |
| 4 | Multi-select share | N selected files → N individual links, sharing a `batchId` for activity-feed grouping. |
| 5 | OG meta tags | Yes (`og:title`, `og:description`, `og:site_name`). `og:image` deferred to v2. |
| 6 | Custom domain | No in v1. Links are `<host>/s/<slug>`. |
| 7 | Default brand accent | Near-black `#0a0a0a`. Custom color is v2. |
| 8 | Tier gating | None in v1 — ship the feature, layer in caps/paywalls later. |
| 9 | Expiry options | 1h / 1d / 7d / 30d / 90d / never. |
| 10 | Password storage | bcrypt (cost 10), never reversible. |
| 11 | Cookie signing | `jose` HS256 JWT, scoped to `/s/<slug>`, 30min TTL, HttpOnly. |
| 12 | Crypto separation | Existing AES-GCM (`lib/crypto.ts`) untouched for S3 secrets. New bcrypt for passwords. New HMAC for cookies. Three primitives, three jobs. |

## Architecture & file structure

Public surface is a Next.js **route group** (`(public)/`) — invisible in URLs, isolated layout, middleware-excluded from Clerk.

```
src/app/
  (public)/                          ← new route group, no Clerk
    layout.tsx                       ← minimal <html><body>, no sidebar, no providers
    s/[slug]/
      page.tsx                       ← server component: landing
      unlock/route.ts                ← POST password → set cookie → redirect
      download/route.ts              ← GET → check → 302 to presigned URL

  (dashboard)/
    shares/
      page.tsx                       ← authenticated manage page

  api/
    share-links/
      route.ts                       ← POST create, GET list
      [id]/route.ts                  ← PATCH edit, DELETE soft-revoke

src/components/
  shares/                            ← authenticated UI
    share-dialog.tsx
    share-list-table.tsx
    share-link-row-actions.tsx
  public-share/                      ← recipient UI
    landing-card.tsx
    password-form.tsx
    brand-header.tsx
    brand-footer.tsx
    unavailable-card.tsx
    not-found-card.tsx

src/lib/
  share-links/
    slug.ts                          ← generateSlug(): 8-char base62
    password.ts                      ← bcrypt hash/verify
    cookie.ts                        ← jose HS256 sign/verify
    status.ts                        ← computeStatus(link): active|expired|exhausted|revoked
    serve.ts                         ← shared: validate, increment, log event
  db/
    share-links.ts                   ← Prisma helpers (matches existing pattern)
```

Files modified:
- `src/middleware.ts` — extend Clerk matcher to exclude `/s/(.*)`
- `src/components/shared/app-sidebar.tsx` — add "Shares" nav entry (Link2 icon)
- `prisma/schema.prisma` — two new models, one new enum, two new values on `ActivityAction`
- `src/components/activity/` — map `SHARE_CREATED` / `SHARE_REVOKED` to label + icon

Estimated: ~14 new files, ~4 modified.

## Data model

```prisma
enum ShareLinkEventAction {
  VIEW            // landing page rendered
  UNLOCK_ATTEMPT  // password submitted (any outcome)
  UNLOCK_SUCCESS  // password correct
  DOWNLOAD        // /download endpoint hit (use count bumped)
}

// Extend existing ActivityAction:
//   SHARE_CREATED
//   SHARE_REVOKED

model ShareLink {
  id           String   @id @default(uuid())
  slug         String   @unique  // 8-char base62

  connectionId String
  connection   Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  bucket       String
  key          String   // single-file in v1; folder shares are v2

  createdById          String?
  createdBy            User?   @relation("ShareLinkCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdByDisplayName String  // snapshot — survives user deletion
  createdByImageUrl    String?

  expiresAt    DateTime?  // null = never expires
  passwordHash String?    // null = no password (bcrypt)
  maxUses      Int?       // null = unlimited
  useCount     Int      @default(0)
  revokedAt    DateTime?  // null = active
  description  String?

  events       ShareLinkEvent[]

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([connectionId, createdAt(sort: Desc)])
  @@index([connectionId, bucket, key, createdAt(sort: Desc)])
  @@map("share_links")
}

model ShareLinkEvent {
  id           String   @id @default(uuid())
  shareLinkId  String
  shareLink    ShareLink @relation(fields: [shareLinkId], references: [id], onDelete: Cascade)

  action       ShareLinkEventAction
  ip           String?    // X-Forwarded-For aware
  userAgent    String?
  referrer     String?

  createdAt    DateTime @default(now())

  @@index([shareLinkId, createdAt(sort: Desc)])
  @@map("share_link_events")
}
```

Reverse relations added to existing models:
- `User`: `createdShareLinks ShareLink[] @relation("ShareLinkCreator")`
- `Connection`: `shareLinks ShareLink[]`

Notes:
- `createdByDisplayName` snapshot mirrors `ActivityEvent` — landing page shows the sender even after the user leaves the team or is deleted.
- `onDelete: SetNull` on creator: revoke power transfers to remaining workspace members.
- `onDelete: Cascade` on connection: deleting a connection invalidates its links (correct — they're un-signable without the connection's credentials).
- No `workspaceId` denormalization — fetched via `connection.workspaceId`. Manage page is connection-scoped so the join cost doesn't bite.
- `useCount` lives on `ShareLink` (incremented atomically at download), not derived from `ShareLinkEvent`. Fast check at `/download` without aggregation.

Migration: `pnpm prisma migrate dev --name add_share_links`.

## API surface

### Authenticated (wrapped in `withAuth`, under `/api/share-links/`)

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/share-links` | Body: `{ connectionId, bucket, key, expiresIn?, password?, maxUses?, description?, batchId? }`. Returns `{ shareLink, url }`. Writes `ActivityEvent(SHARE_CREATED)`. |
| `GET` | `/api/share-links?connectionId=&bucket?=&key?=` | List shares. `connectionId` required. With `bucket+key`: returns only shares for that file (used by share dialog's "Existing shares" section). |
| `GET` | `/api/share-links/[id]` | Single link + last 50 events (manage page detail/analytics drawer). |
| `PATCH` | `/api/share-links/[id]` | Edit `expiresAt`, `password` (null clears), `maxUses`, `description`. Slug / bucket / key immutable. |
| `DELETE` | `/api/share-links/[id]` | **Soft delete** — sets `revokedAt = now()`. Writes `ActivityEvent(SHARE_REVOKED)`. Preserves event history. No hard-delete endpoint in v1. |

Bulk creates fan out client-side as N parallel `POST` calls (concurrency cap of 5) with a shared `batchId` so the activity feed groups them. UI shows per-file progress.

### Public (no auth, under `/s/[slug]/`)

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/s/[slug]` | Server component: resolve link → check status → render password form OR landing card. Writes `ShareLinkEvent(VIEW)` debounced per IP+UA (5min window). |
| `POST` | `/s/[slug]/unlock` | Body: `{ password }`. Rate-limited 5/IP/slug/hour (in-memory LRU). Writes `UNLOCK_ATTEMPT` always, `UNLOCK_SUCCESS` on match. On success: sets HttpOnly signed cookie `share_unlock_<slug>` (30min TTL), redirects to landing. On fail: redirects with `?error=invalid`. |
| `GET` | `/s/[slug]/download` | Validates live + cookie present (if password-gated). Issues 60s presigned URL, writes `DOWNLOAD` event, increments `useCount`, 302 to S3. |

### Race-safe useCount increment (download handler)

Prisma's typed query builder cannot express field-to-field comparison (`useCount < maxUses`) in a single statement. We use a raw SQL UPDATE so the check-and-increment happens atomically inside the database:

```ts
const rows = await prisma.$queryRaw<Array<{ use_count: number }>>`
  UPDATE share_links
  SET use_count = use_count + 1
  WHERE id = ${id}
    AND revoked_at IS NULL
    AND (max_uses IS NULL OR use_count < max_uses)
    AND (expires_at IS NULL OR expires_at > NOW())
  RETURNING use_count
`;
if (rows.length === 0) {
  return new Response("Link no longer available", { status: 410 });
}
```

Returns 0 rows if any condition fails — truly atomic, no race window between "still valid?" and "claim a use." Two simultaneous requests at `useCount=4, maxUses=5` cannot both succeed.

### Status states (computed, not stored)

- `active` — `revokedAt=null && (expiresAt=null || expiresAt > now) && (maxUses=null || useCount < maxUses)`
- `expired` — `expiresAt <= now`
- `exhausted` — `useCount >= maxUses`
- `revoked` — `revokedAt != null`

API responses include the computed `status` on every read.

## Public landing page & branding

### Server component flow (`src/app/(public)/s/[slug]/page.tsx`)

```
1. link = db.shareLink.getBySlug(slug)
2. if !link        → <NotFoundCard />              (404)
3. if revoked      → <UnavailableCard reason="revoked" />   (410)
4. if expired      → <UnavailableCard reason="expired" />   (410)
5. if exhausted    → <UnavailableCard reason="exhausted" /> (410)
6. db.shareLinkEvent.recordView(link.id, headers)  // debounced 5min per IP+UA
7. if link.passwordHash && !cookieValid(slug)
                   → <PasswordForm slug />  (no file metadata leaked)
8. else            → <LandingCard link team />
```

### Body renderer by mime type

`<LandingCard>` picks its body:
- `image/*` → `<ImagePreviewBody>` (reuses existing image preview renderer, sans modal chrome)
- `application/pdf` → `<PdfPreviewBody>`
- `video/*` → `<VideoPreviewBody>`
- `audio/*` → `<AudioPreviewBody>`
- `text/*` ≤ 500KB → `<TextPreviewBody>`
- anything else → `<FallbackCard>` (the boxed card from the mockup)

Inline preview bytes come from a 5-minute presigned URL generated at page render time. Download button hits `/s/[slug]/download` separately (fresh 60s URL, DOWNLOAD event recorded).

### Branding sources

| Field | Source | Fallback |
|---|---|---|
| Brand label | `team.name` via `connection.workspace.team` | "Personal workspace" if PERSONAL; "S3 Dock" if neither |
| Brand logo | None in v1 | Solid `#0a0a0a` 24×24 rounded square |
| Accent color | `#0a0a0a` hard-coded | — |
| Sender name | `link.createdByDisplayName` (snapshot) | — |
| Sender avatar | `link.createdByImageUrl` (snapshot) | Initials |
| Optional message | `link.description` | Section omitted if null |
| Expiry hint | Relative ("Expires in 6d"), server-formatted | Hidden if `expiresAt` is null |

### OG meta tags (Slack/Discord/email unfurl)

```html
<meta property="og:title"       content="{filename}" />
<meta property="og:description" content="Shared by {senderName} via {teamName}" />
<meta property="og:site_name"   content="S3 Dock" />
<meta property="og:type"        content="website" />
<!-- og:image deferred to v2 -->
```

### Unavailable states

Single `<UnavailableCard>` component, varying message:
- Revoked: "This link has been revoked by the sender."
- Expired: "This link expired on {date}."
- Exhausted: "This link has reached its download limit."
- Not found: "This link doesn't exist or has been deleted."

All return appropriate HTTP status (410/404). No third-party JS, no analytics scripts, no cookies other than the unlock cookie — privacy-minimal for security-conscious recipients.

## Password gating, cookies, security

### Password storage

- `bcryptjs` (pure JS, no native compile, Vercel-friendly), cost factor 10.
- Hashed on POST. Never stored plaintext. Hash never returned from any API.

### Cookie signing

- `jose` HS256 JWT, signed with new env var `SHARE_LINK_COOKIE_SECRET` (64-char hex / 32 bytes).
- Payload `{ slug, iat, exp }`; verified on every protected request.
- Cookie name `share_unlock_<slug>`. Path-scoped to `/s/<slug>` so it never leaks to other shares. HttpOnly, Secure (prod), SameSite=Lax.
- No DB roundtrip on verify.

### Crypto separation (three primitives, three jobs)

| Use | Primitive | File |
|---|---|---|
| S3 `secretAccessKey` (need to recover to sign requests) | AES-256-GCM | existing `src/lib/crypto.ts` — untouched |
| Share link password (need to verify a guess) | bcrypt | new `src/lib/share-links/password.ts` |
| Unlock cookie (need to verify origin) | HMAC-SHA256 via JWT | new `src/lib/share-links/cookie.ts` |

Never encrypt passwords with AES-GCM: if `ENCRYPTION_KEY` leaks, every password becomes plaintext. Hashing keeps brute force expensive even with full DB+secret compromise.

### Rate limiting

- 5 password attempts per IP+slug per hour.
- `lru-cache` (~10k entry cap), in-memory.
- 6th attempt: `429`, locked for the rest of the hour.
- Resets on server restart (acceptable for v1; Redis-backed limiter is v2).

### Brute-force resistance

- Slug entropy: 62^8 ≈ 2.18 × 10^14. Effectively unguessable.
- Slug enumeration: every `/s/<unknown>` returns the same `NotFoundCard` with `await sleep(50)` before response to flatten timing leaks.
- Password attempts rate-limited as above.
- No user enumeration on password-gated links: wrong password returns the same generic "invalid" message regardless of underlying state.

### S3 credential safety

- Public routes touch `Connection` only to issue presigned URLs server-side. The recipient never sees credentials directly or transitively.
- Presigned URLs: 60s TTL for downloads, 5min for inline preview embedding.

### Middleware bypass

```ts
// src/middleware.ts
export const config = {
  matcher: [
    "/((?!s/|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

### Out of v1 security scope

- CAPTCHA on password form
- IP allowlists per share link
- 2FA on unlock
- Audit log export endpoint
- Redis-backed rate limiter

## Authenticated UI surfaces

### Share dialog (`src/components/shares/share-dialog.tsx`)

Modal opened from any entry point. Drives both create and view-existing flows.

```
┌─────────────────────────────────────────────┐
│ Share screencast-final.mp4              [×] │
│ acme-prod / videos/2026/06/                 │
├─────────────────────────────────────────────┤
│ Existing shares (2)                         │
│ • Jonathan · 3d ago · 12 views · [copy][⛔] │
│ • Maria    · 1w ago · 0 views  · [copy][⛔] │
├─────────────────────────────────────────────┤
│ Create new share                            │
│ Expires:  [▼ 7 days]                        │
│ ☐ Password protect                          │
│ ☐ Limit to [_] downloads                    │
│ Message: [_______________________]          │
│                            [Create share]   │
└─────────────────────────────────────────────┘
```

Post-create swaps to: short URL + copy button + a "0 views yet" stats area that fills in as `ShareLinkEvent` rows accrue.

### Manage page (`src/app/(dashboard)/shares/page.tsx`)

Table of all shares for the active connection:

- Columns: filename · bucket · status badge · uses · created · expires · actions
- Filters: bucket, status, creator
- Row actions: copy URL, revoke, extend expiry (re-opens dialog in edit mode), view analytics drawer
- Empty state CTA: links back to the file browser
- Search by filename / slug
- Pagination: 50/page

### Entry points

Three places wire `<ShareDialog>`:
1. `file-row.tsx` / `file-tile.tsx` context menu — new "Share..." item (single-file)
2. `bulk-ops-panel.tsx` — new "Share" button when multi-selecting (fans out to N create calls with shared `batchId`)
3. `file-preview-modal.tsx` toolbar — new share icon

### Sidebar

`src/components/shared/app-sidebar.tsx` — new "Shares" entry with `Link2` icon, slotted alongside Activity / Bookmarks.

## Audit & activity feed

- `SHARE_CREATED` and `SHARE_REVOKED` write to `ActivityEvent` with `(connectionId, bucket, key, userDisplayName, batchId)`. Existing activity feed UI picks them up once a small entry is added to the action→label/icon map under `src/components/activity/`.
- Recipient-side `ShareLinkEvent` rows (`VIEW`, `UNLOCK_*`, `DOWNLOAD`) stay in their own table — too noisy for the main feed. Surfaced only in the per-link analytics drawer on the manage page.

## Testing strategy

Matches existing patterns (`vitest`, colocated `*.test.ts`).

| Layer | Files | Coverage |
|---|---|---|
| Unit | `src/lib/share-links/slug.test.ts`, `password.test.ts`, `cookie.test.ts`, `status.test.ts` | Slug entropy/format/uniqueness; bcrypt round-trip; JWT sign/verify (incl. expired, wrong slug, wrong secret); status computation matrix (active / expired / exhausted / revoked / combos). |
| DB | `src/lib/db/share-links.test.ts` | Create; getBySlug (live + soft-revoked); list with filters (connectionId, bucket+key, status); atomic useCount increment race test (concurrent calls when at cap). |
| API | `src/app/api/share-links/route.test.ts`, `[id]/route.test.ts` | Auth enforcement; validation errors; soft-revoke flow; `ActivityEvent` emission with correct fields and `batchId`. |
| Public flow | `src/app/(public)/s/[slug]/page.test.ts`, `unlock/route.test.ts`, `download/route.test.ts` | All status branches; password gate (success / wrong / rate-limited / locked-out); expired / revoked / exhausted with correct HTTP codes; presigned URL is freshly issued each download. |
| Manual | — | Real S3 round-trip on a test bucket; Slack unfurl check; multi-instance race spot-check; landing page accessibility check (keyboard nav, screen reader). |

## v2 deferred — explicit list

1. Folder shares (browseable prefix mini-page)
2. Upload links (recipient → bucket)
3. Custom domains per workspace
4. Custom accent color + logo upload per workspace
5. OG image generation route (`/s/<slug>/og-image`)
6. CAPTCHA on password form
7. Per-link IP allowlists
8. Webhook events on share access (Slack/Discord)
9. QR code in share dialog
10. Redis-backed rate limiter (multi-instance correctness)
11. Tier gating (FREE caps, feature paywalls)
12. Audit log export endpoint
13. Email notification when a share is accessed

## New dependencies

- `bcryptjs` — password hashing
- `jose` — JWT sign/verify for unlock cookie
- `lru-cache` — in-memory rate-limit store

## New environment variables

- `SHARE_LINK_COOKIE_SECRET` — 64-char hex (32 bytes) for HMAC signing. Document in `.env.example`.
