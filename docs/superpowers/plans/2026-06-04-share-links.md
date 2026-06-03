# Smart Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Smart Share Links v1 feature per `docs/superpowers/specs/2026-06-04-share-links-design.md` — a server-owned wrapper around presigned URLs that turns one-click "share this file" into a tracked, controllable link with a branded landing page.

**Architecture:** Next.js route group `(public)/s/[slug]` with no auth, dynamic-redirect-on-download (never proxies bytes). Public surface stays in the same Next.js app, isolated by route group + middleware bypass. Three new crypto primitives stay separate: AES-GCM (existing, for S3 secrets) + bcrypt (new, for share passwords) + HMAC JWT (new, for unlock cookies).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma (PostgreSQL), Zustand, TanStack Query, AWS SDK v3, Clerk, Tailwind 4. Adds `bcryptjs`, `jose`, `lru-cache`.

---

## File Structure

**New files (~17):**

| Path | Responsibility |
|---|---|
| `src/lib/share-links/slug.ts` | 8-char base62 slug generator |
| `src/lib/share-links/password.ts` | bcrypt hash/verify wrapper |
| `src/lib/share-links/cookie.ts` | JOSE HS256 sign/verify for unlock cookie |
| `src/lib/share-links/status.ts` | computeStatus(link) → active/expired/exhausted/revoked |
| `src/lib/share-links/rate-limit.ts` | In-memory LRU rate limiter for unlock attempts |
| `src/lib/db/share-links.ts` | Prisma helpers (create, getBySlug, list, revoke, increment, record event) |
| `src/app/api/share-links/route.ts` | POST create, GET list |
| `src/app/api/share-links/[id]/route.ts` | GET detail, PATCH edit, DELETE soft-revoke |
| `src/app/(public)/layout.tsx` | Minimal layout — no sidebar, no Clerk provider |
| `src/app/(public)/s/[slug]/page.tsx` | Landing page server component |
| `src/app/(public)/s/[slug]/unlock/route.ts` | POST password check |
| `src/app/(public)/s/[slug]/download/route.ts` | GET → atomic increment → 302 to S3 |
| `src/components/public-share/landing-card.tsx` | Boxed/preview card + body renderers |
| `src/components/public-share/password-form.tsx` | Unlock form |
| `src/components/public-share/brand-header.tsx` | Team name + accent + expiry hint |
| `src/components/public-share/brand-footer.tsx` | "Shared via S3 Dock" |
| `src/components/public-share/unavailable-card.tsx` | Revoked/expired/exhausted/not-found shell |
| `src/components/shares/share-dialog.tsx` | Create + view-existing modal |
| `src/components/shares/share-list-table.tsx` | Rows + inline row actions for the manage page |
| `src/app/(dashboard)/shares/page.tsx` | Authenticated manage page |
| `src/lib/queries/share-links.ts` | React Query hooks (useShareLinks, useCreateShare, useRevokeShare) |
| `src/lib/queries/keys.ts` (modify) | Add `shareLinks` key factory |

**Modified files (~6):**

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `ShareLink`, `ShareLinkEvent`, `ShareLinkEventAction`; extend `ActivityAction` with `SHARE_CREATED`, `SHARE_REVOKED`; add reverse relations on `User` and `Connection` |
| `src/components/browser/file-row.tsx` + `file-tile.tsx` | Add "Share..." context menu item |
| `src/components/browser/bulk-ops-panel.tsx` | Add "Share" button that fans out N calls with shared `batchId` |
| `src/components/preview/file-preview-modal.tsx` | Add share icon in toolbar |
| `src/components/shared/app-sidebar.tsx` | Add "Shares" nav entry |
| `src/components/info-drawer/activity-tab.tsx` | Extend `ACTION_VERBS`, `ACTION_LABELS`, `ALL_ACTIONS` with the two new enum values |
| `src/lib/db/activity.ts` | Add `recordActivityWithBatch` helper |
| `.env.example` | Document `SHARE_LINK_COOKIE_SECRET` |
| `package.json` | Add deps |

**Note on Clerk:** This codebase has no `middleware.ts`. Clerk is wired only via `<ClerkProvider>` at the root layout, and auth is enforced per-API-route by `withAuth`. The `(public)` route group needs no middleware bypass — it works because its pages simply don't call `auth()`.

---

### Task 1: Install dependencies and document env var

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
pnpm add bcryptjs jose lru-cache
pnpm add -D @types/bcryptjs
```
Expected: package.json updated, lockfile updated, install succeeds.

- [ ] **Step 2: Add env var to `.env.example`**

Append to `.env.example`:
```
# 64-char hex (32 bytes). Generate with: openssl rand -hex 32
SHARE_LINK_COOKIE_SECRET=
```

- [ ] **Step 3: Generate a local value into `.env`**

Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Paste the output as `SHARE_LINK_COOKIE_SECRET=...` in your local `.env`.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "feat(share-links): add deps and env var"
```

---

### Task 2: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `ShareLinkEventAction` enum**

In `prisma/schema.prisma`, after the existing enums (near `ActivityAction`):
```prisma
enum ShareLinkEventAction {
  VIEW
  UNLOCK_ATTEMPT
  UNLOCK_SUCCESS
  DOWNLOAD
}
```

- [ ] **Step 2: Extend `ActivityAction` enum**

Modify the existing `ActivityAction` enum to add two values at the end:
```prisma
enum ActivityAction {
  UPLOAD
  DELETE
  COPY
  MOVE
  RENAME
  FOLDER_CREATE
  TAG_CHANGE
  BUCKET_CREATE
  BUCKET_DELETE
  SHARE_CREATED
  SHARE_REVOKED
}
```

- [ ] **Step 3: Add `ShareLink` model**

Append to `prisma/schema.prisma`:
```prisma
model ShareLink {
  id           String   @id @default(uuid())
  slug         String   @unique

  connectionId String
  connection   Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  bucket       String
  key          String

  createdById          String?
  createdBy            User?   @relation("ShareLinkCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdByDisplayName String
  createdByImageUrl    String?

  expiresAt    DateTime?
  passwordHash String?
  maxUses      Int?
  useCount     Int      @default(0)
  revokedAt    DateTime?
  description  String?

  events       ShareLinkEvent[]

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([connectionId, createdAt(sort: Desc)])
  @@index([connectionId, bucket, key, createdAt(sort: Desc)])
  @@map("share_links")
}
```

- [ ] **Step 4: Add `ShareLinkEvent` model**

Append to `prisma/schema.prisma`:
```prisma
model ShareLinkEvent {
  id           String   @id @default(uuid())
  shareLinkId  String
  shareLink    ShareLink @relation(fields: [shareLinkId], references: [id], onDelete: Cascade)

  action       ShareLinkEventAction
  ip           String?
  userAgent    String?
  referrer     String?

  createdAt    DateTime @default(now())

  @@index([shareLinkId, createdAt(sort: Desc)])
  @@map("share_link_events")
}
```

- [ ] **Step 5: Add reverse relations on existing models**

In the existing `User` model, add a relation field:
```prisma
  createdShareLinks ShareLink[] @relation("ShareLinkCreator")
```
In the existing `Connection` model, add:
```prisma
  shareLinks ShareLink[]
```

- [ ] **Step 6: Run migration**

Run:
```bash
pnpm prisma migrate dev --name add_share_links
```
Expected: new migration file created under `prisma/migrations/`, Prisma client regenerated at `src/generated/prisma/`.

- [ ] **Step 7: Verify schema compiles**

Run:
```bash
pnpm prisma generate
pnpm tsc --noEmit
```
Expected: both succeed without errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(share-links): add prisma schema for share_links and share_link_events"
```

---

### Task 3: Slug generator (`slug.ts`)

**Files:**
- Create: `src/lib/share-links/slug.ts`
- Create: `src/lib/share-links/slug.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/share-links/slug.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { generateSlug, SLUG_ALPHABET, SLUG_LENGTH } from "./slug";

describe("generateSlug", () => {
  test("produces a string of SLUG_LENGTH characters", () => {
    expect(generateSlug()).toHaveLength(SLUG_LENGTH);
  });

  test("only contains base62 characters", () => {
    const re = new RegExp(`^[${SLUG_ALPHABET}]+$`);
    for (let i = 0; i < 100; i++) {
      expect(generateSlug()).toMatch(re);
    }
  });

  test("returns different slugs across calls (uniqueness sanity)", () => {
    const slugs = new Set(Array.from({ length: 1000 }, () => generateSlug()));
    expect(slugs.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run:
```bash
pnpm test src/lib/share-links/slug.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `slug.ts`**

Create `src/lib/share-links/slug.ts`:
```ts
import { randomBytes } from "crypto";

export const SLUG_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SLUG_LENGTH = 8;

export function generateSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return out;
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run:
```bash
pnpm test src/lib/share-links/slug.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-links/slug.ts src/lib/share-links/slug.test.ts
git commit -m "feat(share-links): add slug generator"
```

---

### Task 4: Password hashing (`password.ts`)

**Files:**
- Create: `src/lib/share-links/password.ts`
- Create: `src/lib/share-links/password.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/share-links/password.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  test("hashPassword returns a bcrypt hash (not plaintext)", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  test("verifyPassword returns true for matching password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  test("verifyPassword returns false for wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  test("each hash uses a fresh salt", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run:
```bash
pnpm test src/lib/share-links/password.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `password.ts`**

Create `src/lib/share-links/password.ts`:
```ts
import bcrypt from "bcryptjs";

const COST = 10;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST);
}

export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run:
```bash
pnpm test src/lib/share-links/password.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-links/password.ts src/lib/share-links/password.test.ts
git commit -m "feat(share-links): add bcrypt password hash/verify"
```

---

### Task 5: Unlock cookie signing (`cookie.ts`)

**Files:**
- Create: `src/lib/share-links/cookie.ts`
- Create: `src/lib/share-links/cookie.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/share-links/cookie.test.ts`:
```ts
import { describe, test, expect, beforeAll } from "vitest";
import { signUnlockCookie, verifyUnlockCookie, COOKIE_TTL_SECONDS } from "./cookie";

beforeAll(() => {
  process.env.SHARE_LINK_COOKIE_SECRET = "a".repeat(64);
});

describe("unlock cookie", () => {
  test("sign + verify round-trip succeeds", async () => {
    const token = await signUnlockCookie("abc12345");
    const slug = await verifyUnlockCookie(token);
    expect(slug).toBe("abc12345");
  });

  test("verify returns null for tampered token", async () => {
    const token = await signUnlockCookie("abc12345");
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifyUnlockCookie(tampered)).toBeNull();
  });

  test("verify returns null for token signed with different secret", async () => {
    const token = await signUnlockCookie("abc12345");
    process.env.SHARE_LINK_COOKIE_SECRET = "b".repeat(64);
    expect(await verifyUnlockCookie(token)).toBeNull();
    process.env.SHARE_LINK_COOKIE_SECRET = "a".repeat(64);
  });

  test("COOKIE_TTL_SECONDS is 30 minutes", () => {
    expect(COOKIE_TTL_SECONDS).toBe(30 * 60);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run:
```bash
pnpm test src/lib/share-links/cookie.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cookie.ts`**

Create `src/lib/share-links/cookie.ts`:
```ts
import { SignJWT, jwtVerify } from "jose";

export const COOKIE_TTL_SECONDS = 30 * 60;
export const COOKIE_NAME_PREFIX = "share_unlock_";

function getSecret(): Uint8Array {
  const hex = process.env.SHARE_LINK_COOKIE_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "SHARE_LINK_COOKIE_SECRET must be a 64-character hex string (32 bytes)"
    );
  }
  return new TextEncoder().encode(hex);
}

export async function signUnlockCookie(slug: string): Promise<string> {
  return new SignJWT({ slug })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyUnlockCookie(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (typeof payload.slug !== "string") return null;
    return payload.slug;
  } catch {
    return null;
  }
}

export function cookieNameForSlug(slug: string): string {
  return `${COOKIE_NAME_PREFIX}${slug}`;
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run:
```bash
pnpm test src/lib/share-links/cookie.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-links/cookie.ts src/lib/share-links/cookie.test.ts
git commit -m "feat(share-links): add unlock cookie signing"
```

---

### Task 6: Status computation (`status.ts`)

**Files:**
- Create: `src/lib/share-links/status.ts`
- Create: `src/lib/share-links/status.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/share-links/status.test.ts`:
```ts
import { describe, test, expect } from "vitest";
import { computeStatus, type StatusInputs } from "./status";

const base: StatusInputs = {
  revokedAt: null,
  expiresAt: null,
  maxUses: null,
  useCount: 0,
};

describe("computeStatus", () => {
  test("active when nothing is set", () => {
    expect(computeStatus(base, new Date())).toBe("active");
  });

  test("revoked when revokedAt set", () => {
    expect(
      computeStatus({ ...base, revokedAt: new Date() }, new Date())
    ).toBe("revoked");
  });

  test("expired when expiresAt is in the past", () => {
    expect(
      computeStatus(
        { ...base, expiresAt: new Date("2026-01-01") },
        new Date("2026-06-04")
      )
    ).toBe("expired");
  });

  test("active when expiresAt is in the future", () => {
    expect(
      computeStatus(
        { ...base, expiresAt: new Date("2026-12-31") },
        new Date("2026-06-04")
      )
    ).toBe("active");
  });

  test("exhausted when useCount >= maxUses", () => {
    expect(
      computeStatus({ ...base, maxUses: 5, useCount: 5 }, new Date())
    ).toBe("exhausted");
  });

  test("active when useCount < maxUses", () => {
    expect(
      computeStatus({ ...base, maxUses: 5, useCount: 4 }, new Date())
    ).toBe("active");
  });

  test("revoked beats expired", () => {
    expect(
      computeStatus(
        {
          ...base,
          revokedAt: new Date("2026-06-04"),
          expiresAt: new Date("2026-01-01"),
        },
        new Date("2026-06-04")
      )
    ).toBe("revoked");
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run:
```bash
pnpm test src/lib/share-links/status.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `status.ts`**

Create `src/lib/share-links/status.ts`:
```ts
export type ShareLinkStatus = "active" | "expired" | "exhausted" | "revoked";

export type StatusInputs = {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
};

export function computeStatus(link: StatusInputs, now: Date): ShareLinkStatus {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && link.expiresAt <= now) return "expired";
  if (link.maxUses !== null && link.useCount >= link.maxUses) return "exhausted";
  return "active";
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run:
```bash
pnpm test src/lib/share-links/status.test.ts
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-links/status.ts src/lib/share-links/status.test.ts
git commit -m "feat(share-links): add status computation"
```

---

### Task 7: Rate limiter (`rate-limit.ts`)

**Files:**
- Create: `src/lib/share-links/rate-limit.ts`
- Create: `src/lib/share-links/rate-limit.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/share-links/rate-limit.test.ts`:
```ts
import { describe, test, expect, beforeEach } from "vitest";
import { checkUnlockRateLimit, resetUnlockRateLimit } from "./rate-limit";

beforeEach(() => resetUnlockRateLimit());

describe("checkUnlockRateLimit", () => {
  test("allows first 5 attempts per ip+slug", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkUnlockRateLimit("1.2.3.4", "abc12345")).toBe(true);
    }
  });

  test("blocks the 6th attempt within the window", () => {
    for (let i = 0; i < 5; i++) checkUnlockRateLimit("1.2.3.4", "abc12345");
    expect(checkUnlockRateLimit("1.2.3.4", "abc12345")).toBe(false);
  });

  test("different ip+slug pairs are isolated", () => {
    for (let i = 0; i < 5; i++) checkUnlockRateLimit("1.2.3.4", "abc12345");
    expect(checkUnlockRateLimit("9.9.9.9", "abc12345")).toBe(true);
    expect(checkUnlockRateLimit("1.2.3.4", "different")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run:
```bash
pnpm test src/lib/share-links/rate-limit.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `rate-limit.ts`**

Create `src/lib/share-links/rate-limit.ts`:
```ts
import { LRUCache } from "lru-cache";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000;

let cache = new LRUCache<string, number>({ max: 10000, ttl: WINDOW_MS });

function key(ip: string, slug: string): string {
  return `${ip}:${slug}`;
}

export function checkUnlockRateLimit(ip: string, slug: string): boolean {
  const k = key(ip, slug);
  const count = cache.get(k) ?? 0;
  if (count >= MAX_ATTEMPTS) return false;
  cache.set(k, count + 1);
  return true;
}

export function resetUnlockRateLimit(): void {
  cache = new LRUCache<string, number>({ max: 10000, ttl: WINDOW_MS });
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run:
```bash
pnpm test src/lib/share-links/rate-limit.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-links/rate-limit.ts src/lib/share-links/rate-limit.test.ts
git commit -m "feat(share-links): add in-memory unlock rate limiter"
```

---

### Task 8: DB helper — create + getBySlug + list

**Files:**
- Create: `src/lib/db/share-links.ts`
- Create: `src/lib/db/share-links.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/db/share-links.test.ts`:
```ts
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    shareLink: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    shareLinkEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import prisma from "@/lib/db/prisma";
import {
  createShareLink,
  getShareLinkBySlug,
  listShareLinksByConnection,
} from "./share-links";

beforeEach(() => vi.clearAllMocks());

describe("createShareLink", () => {
  test("creates a row with the provided fields and generated slug", async () => {
    (prisma.shareLink.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
      slug: "abc12345",
    });
    const result = await createShareLink({
      connectionId: "conn-1",
      bucket: "b",
      key: "k",
      createdById: "u-1",
      createdByDisplayName: "Alice",
      createdByImageUrl: null,
      expiresAt: null,
      passwordHash: null,
      maxUses: null,
      description: null,
    });
    expect(prisma.shareLink.create).toHaveBeenCalledOnce();
    const call = (prisma.shareLink.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.data.connectionId).toBe("conn-1");
    expect(call.data.slug).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(result.id).toBe("sl-1");
  });
});

describe("getShareLinkBySlug", () => {
  test("returns the link when found", async () => {
    (prisma.shareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
      slug: "abc12345",
    });
    const result = await getShareLinkBySlug("abc12345");
    expect(prisma.shareLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc12345" },
      include: { connection: true },
    });
    expect(result?.id).toBe("sl-1");
  });

  test("returns null when not found", async () => {
    (prisma.shareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await getShareLinkBySlug("missing0")).toBeNull();
  });
});

describe("listShareLinksByConnection", () => {
  test("filters by connectionId and orders by createdAt desc", async () => {
    (prisma.shareLink.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listShareLinksByConnection("conn-1");
    expect(prisma.shareLink.findMany).toHaveBeenCalledWith({
      where: { connectionId: "conn-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  test("optionally filters by bucket and key", async () => {
    (prisma.shareLink.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await listShareLinksByConnection("conn-1", { bucket: "b", key: "k" });
    expect(prisma.shareLink.findMany).toHaveBeenCalledWith({
      where: { connectionId: "conn-1", bucket: "b", key: "k" },
      orderBy: { createdAt: "desc" },
    });
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run:
```bash
pnpm test src/lib/db/share-links.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement create + getBySlug + list**

Create `src/lib/db/share-links.ts`:
```ts
import prisma from "@/lib/db/prisma";
import type { ShareLink, ShareLinkEvent } from "@/generated/prisma/client";
import { generateSlug } from "@/lib/share-links/slug";

export type CreateShareLinkInput = {
  connectionId: string;
  bucket: string;
  key: string;
  createdById: string;
  createdByDisplayName: string;
  createdByImageUrl: string | null;
  expiresAt: Date | null;
  passwordHash: string | null;
  maxUses: number | null;
  description: string | null;
};

export async function createShareLink(
  input: CreateShareLinkInput
): Promise<ShareLink> {
  return prisma.shareLink.create({
    data: {
      slug: generateSlug(),
      connectionId: input.connectionId,
      bucket: input.bucket,
      key: input.key,
      createdById: input.createdById,
      createdByDisplayName: input.createdByDisplayName,
      createdByImageUrl: input.createdByImageUrl,
      expiresAt: input.expiresAt,
      passwordHash: input.passwordHash,
      maxUses: input.maxUses,
      description: input.description,
    },
  });
}

export async function getShareLinkBySlug(slug: string) {
  return prisma.shareLink.findUnique({
    where: { slug },
    include: { connection: true },
  });
}

export type ListFilter = {
  bucket?: string;
  key?: string;
};

export async function listShareLinksByConnection(
  connectionId: string,
  filter: ListFilter = {}
): Promise<ShareLink[]> {
  return prisma.shareLink.findMany({
    where: {
      connectionId,
      ...(filter.bucket ? { bucket: filter.bucket } : {}),
      ...(filter.key ? { key: filter.key } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run:
```bash
pnpm test src/lib/db/share-links.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/share-links.ts src/lib/db/share-links.test.ts
git commit -m "feat(share-links): db helpers for create/getBySlug/list"
```

---

### Task 9: DB helper — revoke + record event + atomic increment

**Files:**
- Modify: `src/lib/db/share-links.ts`
- Modify: `src/lib/db/share-links.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/db/share-links.test.ts`:
```ts
import {
  revokeShareLink,
  recordShareLinkEvent,
  atomicIncrementUseCount,
  getShareLinkWithEvents,
} from "./share-links";

describe("revokeShareLink", () => {
  test("sets revokedAt to now", async () => {
    const before = Date.now();
    (prisma.shareLink.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
    });
    await revokeShareLink("sl-1");
    const call = (prisma.shareLink.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.where).toEqual({ id: "sl-1" });
    expect(call.data.revokedAt).toBeInstanceOf(Date);
    expect((call.data.revokedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("recordShareLinkEvent", () => {
  test("creates an event row with the provided action and headers", async () => {
    (prisma.shareLinkEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await recordShareLinkEvent({
      shareLinkId: "sl-1",
      action: "DOWNLOAD",
      ip: "1.2.3.4",
      userAgent: "Mozilla",
      referrer: null,
    });
    expect(prisma.shareLinkEvent.create).toHaveBeenCalledWith({
      data: {
        shareLinkId: "sl-1",
        action: "DOWNLOAD",
        ip: "1.2.3.4",
        userAgent: "Mozilla",
        referrer: null,
      },
    });
  });
});

describe("atomicIncrementUseCount", () => {
  test("returns true when the raw update affected a row", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      { use_count: 1 },
    ]);
    expect(await atomicIncrementUseCount("sl-1")).toBe(true);
  });

  test("returns false when no row matched (exhausted/expired/revoked)", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(await atomicIncrementUseCount("sl-1")).toBe(false);
  });
});

describe("getShareLinkWithEvents", () => {
  test("returns link with last 50 events ordered desc", async () => {
    (prisma.shareLink.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sl-1",
      events: [],
    });
    await getShareLinkWithEvents("sl-1");
    expect(prisma.shareLink.findUnique).toHaveBeenCalledWith({
      where: { id: "sl-1" },
      include: {
        events: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

Run:
```bash
pnpm test src/lib/db/share-links.test.ts
```
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement the new functions**

Append to `src/lib/db/share-links.ts`:
```ts
import type { ShareLinkEventAction } from "@/generated/prisma/client";

export async function revokeShareLink(id: string): Promise<ShareLink> {
  return prisma.shareLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export type RecordEventInput = {
  shareLinkId: string;
  action: ShareLinkEventAction;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
};

export async function recordShareLinkEvent(
  input: RecordEventInput
): Promise<ShareLinkEvent> {
  return prisma.shareLinkEvent.create({
    data: {
      shareLinkId: input.shareLinkId,
      action: input.action,
      ip: input.ip,
      userAgent: input.userAgent,
      referrer: input.referrer,
    },
  });
}

export async function atomicIncrementUseCount(id: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ use_count: number }>>`
    UPDATE share_links
    SET use_count = use_count + 1
    WHERE id = ${id}
      AND revoked_at IS NULL
      AND (max_uses IS NULL OR use_count < max_uses)
      AND (expires_at IS NULL OR expires_at > NOW())
    RETURNING use_count
  `;
  return rows.length > 0;
}

export async function getShareLinkWithEvents(id: string) {
  return prisma.shareLink.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
}

export async function getShareLinkById(id: string) {
  return prisma.shareLink.findUnique({
    where: { id },
    include: { connection: true },
  });
}

export type EditShareLinkInput = {
  expiresAt?: Date | null;
  passwordHash?: string | null;
  maxUses?: number | null;
  description?: string | null;
};

export async function editShareLink(
  id: string,
  input: EditShareLinkInput
): Promise<ShareLink> {
  return prisma.shareLink.update({
    where: { id },
    data: input,
  });
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run:
```bash
pnpm test src/lib/db/share-links.test.ts
```
Expected: PASS, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/share-links.ts src/lib/db/share-links.test.ts
git commit -m "feat(share-links): db helpers for revoke/event/atomic-increment/edit"
```

---

### Task 10: API — POST /api/share-links (create)

**Files:**
- Create: `src/app/api/share-links/route.ts`

- [ ] **Step 1: Implement POST handler**

Create `src/app/api/share-links/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import {
  createShareLink,
  listShareLinksByConnection,
} from "@/lib/db/share-links";
import { recordActivity } from "@/lib/db/activity";
import { hashPassword } from "@/lib/share-links/password";
import { computeStatus } from "@/lib/share-links/status";

function displayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  );
}

function publicUrl(req: NextRequest, slug: string): string {
  const origin = req.nextUrl.origin;
  return `${origin}/s/${slug}`;
}

function toResponse(link: {
  id: string;
  slug: string;
  bucket: string;
  key: string;
  createdById: string | null;
  createdByDisplayName: string;
  createdByImageUrl: string | null;
  expiresAt: Date | null;
  passwordHash: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  description: string | null;
  createdAt: Date;
}) {
  return {
    id: link.id,
    slug: link.slug,
    bucket: link.bucket,
    key: link.key,
    createdById: link.createdById,
    createdByDisplayName: link.createdByDisplayName,
    createdByImageUrl: link.createdByImageUrl,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    hasPassword: link.passwordHash !== null,
    maxUses: link.maxUses,
    useCount: link.useCount,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    description: link.description,
    createdAt: link.createdAt.toISOString(),
    status: computeStatus(link, new Date()),
  };
}

export const POST = withAuth(async (req: NextRequest, { user }) => {
  const body = await req.json();
  const {
    connectionId,
    bucket,
    key,
    expiresIn,
    password,
    maxUses,
    description,
  } = body as {
    connectionId?: string;
    bucket?: string;
    key?: string;
    expiresIn?: number | null;
    password?: string | null;
    maxUses?: number | null;
    description?: string | null;
  };

  if (!connectionId || !bucket || !key) {
    return NextResponse.json(
      { error: "connectionId, bucket, and key are required" },
      { status: 400 }
    );
  }

  const access = await getConnectionAccessById(connectionId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const expiresAt =
    typeof expiresIn === "number" && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

  const passwordHash =
    typeof password === "string" && password.length > 0
      ? await hashPassword(password)
      : null;

  const created = await createShareLink({
    connectionId,
    bucket,
    key,
    createdById: user.id,
    createdByDisplayName: displayName(user),
    createdByImageUrl: user.imageUrl ?? null,
    expiresAt,
    passwordHash,
    maxUses: typeof maxUses === "number" && maxUses > 0 ? maxUses : null,
    description: typeof description === "string" ? description.trim() || null : null,
  });

  await recordActivity({
    connectionId,
    userId: user.id,
    userDisplayName: displayName(user),
    userImageUrl: user.imageUrl ?? null,
    action: "SHARE_CREATED",
    bucket,
    key,
  });

  return NextResponse.json({
    shareLink: toResponse(created),
    url: publicUrl(req, created.slug),
  });
});

export const GET = withAuth(async (req: NextRequest, { user }) => {
  const { searchParams } = req.nextUrl;
  const connectionId = searchParams.get("connectionId");
  const bucket = searchParams.get("bucket") ?? undefined;
  const key = searchParams.get("key") ?? undefined;

  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 }
    );
  }

  const access = await getConnectionAccessById(connectionId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const links = await listShareLinksByConnection(connectionId, { bucket, key });
  return NextResponse.json({ shareLinks: links.map(toResponse) });
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm tsc --noEmit
```
Expected: succeeds (no type errors).

- [ ] **Step 3: Manual smoke test (dev server)**

Run `pnpm dev` in one terminal. From another (or browser DevTools), sign in to your app, then `POST` to `/api/share-links` with body `{ "connectionId": "<a real conn>", "bucket": "<bucket>", "key": "<key>" }`. Expected: 200 with `{ shareLink, url }`. Verify in DB:
```bash
psql $DATABASE_URL -c "SELECT id, slug, bucket, key, created_by_display_name FROM share_links ORDER BY created_at DESC LIMIT 1;"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/share-links/route.ts
git commit -m "feat(share-links): POST /api/share-links + GET list"
```

---

### Task 11: API — single link (GET detail, PATCH edit, DELETE revoke)

**Files:**
- Create: `src/app/api/share-links/[id]/route.ts`

- [ ] **Step 1: Implement the three handlers**

The `withAuth` wrapper supports typed dynamic params via the `RouteContext` pattern. Match `src/app/api/notes/[id]/route.ts` exactly.

Create `src/app/api/share-links/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getConnectionAccessById } from "@/lib/db/connections";
import {
  getShareLinkById,
  getShareLinkWithEvents,
  editShareLink,
  revokeShareLink,
} from "@/lib/db/share-links";
import { recordActivity } from "@/lib/db/activity";
import { hashPassword } from "@/lib/share-links/password";
import { computeStatus } from "@/lib/share-links/status";

type RouteContext = { params: Promise<{ id: string }> };

function displayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  );
}

async function loadAndAuthorize(id: string, userId: string) {
  const link = await getShareLinkById(id);
  if (!link) return { error: "not-found" as const };
  const access = await getConnectionAccessById(link.connectionId, userId);
  if (!access) return { error: "not-found" as const };
  return { link, access };
}

export const GET = withAuth<RouteContext>(async (_req, { user, params }) => {
  const { id } = await params;
  const linkBase = await loadAndAuthorize(id, user.id);
  if ("error" in linkBase) {
    return NextResponse.json({ error: "Share link not found" }, { status: 404 });
  }
  const full = await getShareLinkWithEvents(id);
  if (!full) return NextResponse.json({ error: "Share link not found" }, { status: 404 });

  return NextResponse.json({
    shareLink: {
      id: full.id,
      slug: full.slug,
      bucket: full.bucket,
      key: full.key,
      createdById: full.createdById,
      createdByDisplayName: full.createdByDisplayName,
      createdByImageUrl: full.createdByImageUrl,
      expiresAt: full.expiresAt?.toISOString() ?? null,
      hasPassword: full.passwordHash !== null,
      maxUses: full.maxUses,
      useCount: full.useCount,
      revokedAt: full.revokedAt?.toISOString() ?? null,
      description: full.description,
      createdAt: full.createdAt.toISOString(),
      status: computeStatus(full, new Date()),
    },
    events: full.events.map((e) => ({
      id: e.id,
      action: e.action,
      ip: e.ip,
      userAgent: e.userAgent,
      referrer: e.referrer,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

export const PATCH = withAuth<RouteContext>(async (req, { user, params }) => {
  const { id } = await params;
  const linkBase = await loadAndAuthorize(id, user.id);
  if ("error" in linkBase) {
    return NextResponse.json({ error: "Share link not found" }, { status: 404 });
  }

  const body = await req.json();
  const { expiresAt, password, maxUses, description } = body as {
    expiresAt?: string | null;
    password?: string | null;
    maxUses?: number | null;
    description?: string | null;
  };

  const patch: Parameters<typeof editShareLink>[1] = {};
  if (expiresAt !== undefined) {
    patch.expiresAt = expiresAt === null ? null : new Date(expiresAt);
  }
  if (password !== undefined) {
    patch.passwordHash =
      password === null || password === "" ? null : await hashPassword(password);
  }
  if (maxUses !== undefined) {
    patch.maxUses = maxUses === null || maxUses <= 0 ? null : maxUses;
  }
  if (description !== undefined) {
    patch.description = description === null ? null : description.trim() || null;
  }

  const updated = await editShareLink(id, patch);
  return NextResponse.json({
    shareLink: {
      id: updated.id,
      slug: updated.slug,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
      hasPassword: updated.passwordHash !== null,
      maxUses: updated.maxUses,
      description: updated.description,
      status: computeStatus(updated, new Date()),
    },
  });
});

export const DELETE = withAuth<RouteContext>(async (_req, { user, params }) => {
  const { id } = await params;
  const linkBase = await loadAndAuthorize(id, user.id);
  if ("error" in linkBase) {
    return NextResponse.json({ error: "Share link not found" }, { status: 404 });
  }

  const revoked = await revokeShareLink(id);
  await recordActivity({
    connectionId: linkBase.link.connectionId,
    userId: user.id,
    userDisplayName: displayName(user),
    userImageUrl: user.imageUrl ?? null,
    action: "SHARE_REVOKED",
    bucket: linkBase.link.bucket,
    key: linkBase.link.key,
  });

  return NextResponse.json({ revokedAt: revoked.revokedAt?.toISOString() ?? null });
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 3: Smoke test PATCH and DELETE**

With the dev server running and a real share link in the DB:
```bash
# Revoke
curl -X DELETE -b "<auth cookie>" http://localhost:3000/api/share-links/<id>
# Verify
psql $DATABASE_URL -c "SELECT id, revoked_at FROM share_links WHERE id='<id>';"
```
Expected: `revoked_at` is now non-null. Activity row written.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/share-links/[id]/route.ts
git commit -m "feat(share-links): GET/PATCH/DELETE single share link"
```

---

### Task 12: Public route group layout

**Files:**
- Create: `src/app/(public)/layout.tsx`

> **Note for implementer:** This codebase has NO `middleware.ts`. Clerk is set up via `<ClerkProvider>` at the root layout (`src/app/layout.tsx`) and auth is enforced **per-API-route** via the `withAuth` wrapper in `src/lib/auth/protect.ts`. Page routes that need auth presumably read user state at render time. Result: no middleware bypass is needed — `(public)/s/[slug]/page.tsx` simply doesn't call `auth()` and so renders fine for unauthenticated visitors. The `(public)` route group exists purely to give recipient pages their own layout (no sidebar/header) — the (dashboard) layout already only applies inside that group.

- [ ] **Step 1: Create the public layout**

The root layout (`src/app/layout.tsx`) already declares `<html>`, `<body>`, `<ClerkProvider>`, and `<Providers>`. Nested layouts in Next.js App Router must NOT redeclare those. The `(public)` layout is intentionally a thin pass-through — its only job is to scope the URL group and make the architectural seam explicit.

Create `src/app/(public)/layout.tsx`:
```tsx
import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  // Intentionally minimal — the root layout (src/app/layout.tsx) provides
  // <html>, <body>, ClerkProvider, and Providers. This layout exists purely
  // to scope the route group so recipient pages never accidentally inherit
  // the (dashboard) chrome (sidebar/header).
  return <>{children}</>;
}
```

- [ ] **Step 2: Verify the build**

Run:
```bash
pnpm build
```
Expected: succeeds. No "two <html> elements" error.

- [ ] **Step 3: Commit**

```bash
git add src/app/(public)/layout.tsx
git commit -m "feat(share-links): public route group"
```

---

### Task 13: Public landing — page skeleton with status branches

**Files:**
- Create: `src/app/(public)/s/[slug]/page.tsx`
- Create: `src/components/public-share/unavailable-card.tsx`

- [ ] **Step 1: Create `UnavailableCard` component**

Create `src/components/public-share/unavailable-card.tsx`:
```tsx
type Reason = "revoked" | "expired" | "exhausted" | "not-found";

const COPY: Record<Reason, { title: string; body: string }> = {
  revoked: {
    title: "Link revoked",
    body: "This link has been revoked by the sender.",
  },
  expired: {
    title: "Link expired",
    body: "This link is no longer available.",
  },
  exhausted: {
    title: "Download limit reached",
    body: "This link has reached its download limit.",
  },
  "not-found": {
    title: "Link not found",
    body: "This link doesn't exist or has been deleted.",
  },
};

export function UnavailableCard({ reason }: { reason: Reason }) {
  const { title, body } = COPY[reason];
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
        <h1 className="text-xl font-semibold mb-2">{title}</h1>
        <p className="text-sm text-neutral-600">{body}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create page skeleton**

Create `src/app/(public)/s/[slug]/page.tsx`:
```tsx
import { headers, cookies } from "next/headers";
import { getShareLinkBySlug, recordShareLinkEvent } from "@/lib/db/share-links";
import { computeStatus } from "@/lib/share-links/status";
import { verifyUnlockCookie, cookieNameForSlug } from "@/lib/share-links/cookie";
import { UnavailableCard } from "@/components/public-share/unavailable-card";
import { PasswordForm } from "@/components/public-share/password-form";
import { LandingCard } from "@/components/public-share/landing-card";

export const dynamic = "force-dynamic";

async function timingFlattenedNotFound() {
  await new Promise((r) => setTimeout(r, 50));
  return <UnavailableCard reason="not-found" />;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const link = await getShareLinkBySlug(slug);
  if (!link) return { title: "Share" };
  const status = computeStatus(link, new Date());
  if (status !== "active") return { title: "Share" };

  const filename = link.key.split("/").pop() ?? link.key;
  return {
    title: filename,
    description: `Shared by ${link.createdByDisplayName}`,
    openGraph: {
      title: filename,
      description: `Shared by ${link.createdByDisplayName} via S3 Dock`,
      siteName: "S3 Dock",
      type: "website",
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const link = await getShareLinkBySlug(slug);
  if (!link) return await timingFlattenedNotFound();

  const status = computeStatus(link, new Date());
  if (status === "revoked") return <UnavailableCard reason="revoked" />;
  if (status === "expired") return <UnavailableCard reason="expired" />;
  if (status === "exhausted") return <UnavailableCard reason="exhausted" />;

  // record VIEW (fire-and-forget; debounced per IP+UA in a follow-up enhancement)
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = h.get("user-agent") ?? null;
  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "VIEW",
    ip,
    userAgent: ua,
    referrer: h.get("referer") ?? null,
  });

  if (link.passwordHash) {
    const c = await cookies();
    const cookieVal = c.get(cookieNameForSlug(slug))?.value;
    const ok = cookieVal ? (await verifyUnlockCookie(cookieVal)) === slug : false;
    if (!ok) return <PasswordForm slug={slug} />;
  }

  return <LandingCard link={link} />;
}
```

- [ ] **Step 3: Stub the imports we haven't built yet**

Create empty stubs so the file type-checks. We'll fill them in subsequent tasks.

Create `src/components/public-share/password-form.tsx`:
```tsx
export function PasswordForm({ slug }: { slug: string }) {
  return <div>Password form for {slug}</div>;
}
```

Create `src/components/public-share/landing-card.tsx`:
```tsx
import type { ShareLink, Connection } from "@/generated/prisma/client";

export function LandingCard({
  link,
}: {
  link: ShareLink & { connection: Connection };
}) {
  return <div>Landing card for {link.key}</div>;
}
```

- [ ] **Step 4: Type-check**

Run:
```bash
pnpm tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 5: Manually check a created link in the browser**

With `pnpm dev` running and a share link in the DB, visit `http://localhost:3000/s/<slug>`. Expected: the page renders the stub "Landing card for ...". Visit `http://localhost:3000/s/doesnotexist`. Expected: "Link not found" card.

- [ ] **Step 6: Commit**

```bash
git add src/app/(public)/s/[slug]/page.tsx src/components/public-share/
git commit -m "feat(share-links): public landing page skeleton with status branches"
```

---

### Task 14: Unlock route + password form

**Files:**
- Create: `src/app/(public)/s/[slug]/unlock/route.ts`
- Modify: `src/components/public-share/password-form.tsx`

- [ ] **Step 1: Implement unlock route**

Create `src/app/(public)/s/[slug]/unlock/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import {
  getShareLinkBySlug,
  recordShareLinkEvent,
} from "@/lib/db/share-links";
import { verifyPassword } from "@/lib/share-links/password";
import {
  signUnlockCookie,
  cookieNameForSlug,
  COOKIE_TTL_SECONDS,
} from "@/lib/share-links/cookie";
import { checkUnlockRateLimit } from "@/lib/share-links/rate-limit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const form = await req.formData();
  const password = (form.get("password") ?? "").toString();
  const redirectTo = new URL(`/s/${slug}`, req.url);

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (!checkUnlockRateLimit(ip, slug)) {
    redirectTo.searchParams.set("error", "rate-limited");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  const link = await getShareLinkBySlug(slug);
  if (!link || !link.passwordHash) {
    redirectTo.searchParams.set("error", "invalid");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "UNLOCK_ATTEMPT",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
    referrer: null,
  });

  const ok = await verifyPassword(password, link.passwordHash);
  if (!ok) {
    redirectTo.searchParams.set("error", "invalid");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "UNLOCK_SUCCESS",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
    referrer: null,
  });

  const token = await signUnlockCookie(slug);
  const c = await cookies();
  c.set(cookieNameForSlug(slug), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/s/${slug}`,
    maxAge: COOKIE_TTL_SECONDS,
  });

  return NextResponse.redirect(redirectTo, { status: 303 });
}
```

- [ ] **Step 2: Replace the password form stub**

Replace `src/components/public-share/password-form.tsx`:
```tsx
type Props = {
  slug: string;
  error?: string;
};

export function PasswordForm({ slug, error }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        method="POST"
        action={`/s/${slug}/unlock`}
        className="bg-white rounded-xl shadow p-8 max-w-md w-full"
      >
        <h1 className="text-xl font-semibold mb-2">Password required</h1>
        <p className="text-sm text-neutral-600 mb-4">
          This share link is password-protected.
        </p>
        <input
          type="password"
          name="password"
          autoFocus
          required
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm mb-3"
          placeholder="Password"
        />
        {error === "invalid" && (
          <p className="text-sm text-red-600 mb-3">Invalid password.</p>
        )}
        {error === "rate-limited" && (
          <p className="text-sm text-red-600 mb-3">
            Too many attempts. Try again in an hour.
          </p>
        )}
        <button
          type="submit"
          className="w-full bg-neutral-900 text-white rounded-md py-2 text-sm font-medium"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wire the `error` query param through `page.tsx`**

In `src/app/(public)/s/[slug]/page.tsx`, accept `searchParams` and pass `error` to `<PasswordForm>`:
```tsx
export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  // ... rest unchanged, but replace:
  //   if (!ok) return <PasswordForm slug={slug} />;
  // with:
  //   if (!ok) return <PasswordForm slug={slug} error={error} />;
```

- [ ] **Step 4: Type-check + manual test**

Run:
```bash
pnpm tsc --noEmit
```
Then with dev server: create a share link with a password (use the API directly), visit `/s/<slug>`, confirm password form renders. Submit wrong password — confirm "Invalid password" message. Submit right password — confirm you bypass the form on next reload. Hit it 6× quickly — confirm rate-limit message.

- [ ] **Step 5: Commit**

```bash
git add src/app/(public)/s/[slug]/unlock/ src/components/public-share/password-form.tsx src/app/(public)/s/[slug]/page.tsx
git commit -m "feat(share-links): password unlock route + form"
```

---

### Task 15: Download route with atomic increment

**Files:**
- Create: `src/app/(public)/s/[slug]/download/route.ts`

- [ ] **Step 1: Implement download route**

Create `src/app/(public)/s/[slug]/download/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client } from "@/lib/s3/client";
import { decrypt } from "@/lib/crypto";
import {
  getShareLinkBySlug,
  atomicIncrementUseCount,
  recordShareLinkEvent,
} from "@/lib/db/share-links";
import {
  verifyUnlockCookie,
  cookieNameForSlug,
} from "@/lib/share-links/cookie";

const DOWNLOAD_URL_TTL_SECONDS = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const link = await getShareLinkBySlug(slug);
  if (!link) {
    return new NextResponse("Link not found", { status: 404 });
  }

  if (link.passwordHash) {
    const c = await cookies();
    const cookieVal = c.get(cookieNameForSlug(slug))?.value;
    const ok = cookieVal ? (await verifyUnlockCookie(cookieVal)) === slug : false;
    if (!ok) {
      return new NextResponse("Password required", { status: 401 });
    }
  }

  const claimed = await atomicIncrementUseCount(link.id);
  if (!claimed) {
    return new NextResponse("Link no longer available", { status: 410 });
  }

  const h = await headers();
  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "DOWNLOAD",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
    referrer: h.get("referer") ?? null,
  });

  const client = createS3Client({
    ...link.connection,
    secretAccessKey: decrypt(link.connection.secretAccessKey),
  });
  const command = new GetObjectCommand({
    Bucket: link.bucket,
    Key: link.key,
  });
  const signedUrl = await getSignedUrl(client, command, {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  });

  return NextResponse.redirect(signedUrl, { status: 302 });
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 3: Manual test**

With a share link in DB pointing to a real S3 object: visit `/s/<slug>/download` (or click the download button in the landing card later). Expected: 302 redirect to a presigned S3 URL; file downloads. Hit it again, check `use_count` in the DB has incremented. Set `max_uses=2` on a link via PATCH, hit download 3×, third call returns 410.

- [ ] **Step 4: Commit**

```bash
git add src/app/(public)/s/[slug]/download/
git commit -m "feat(share-links): download route with atomic use-count increment"
```

---

### Task 16: Brand header, footer, fallback landing card

**Files:**
- Create: `src/components/public-share/brand-header.tsx`
- Create: `src/components/public-share/brand-footer.tsx`
- Modify: `src/components/public-share/landing-card.tsx`

- [ ] **Step 1: Brand header**

Create `src/components/public-share/brand-header.tsx`:
```tsx
type Props = {
  teamLabel: string;
  expiresAt: Date | null;
};

function formatExpiry(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "expired";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) return `Expires in ${days}d`;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours >= 1) return `Expires in ${hours}h`;
  const mins = Math.floor(diffMs / (1000 * 60));
  return `Expires in ${mins}m`;
}

export function BrandHeader({ teamLabel, expiresAt }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100">
      <div className="w-6 h-6 bg-neutral-900 rounded-md" />
      <span className="text-xs font-semibold tracking-wider uppercase text-neutral-900">
        {teamLabel}
      </span>
      <span className="flex-1" />
      {expiresAt && (
        <span className="text-xs text-neutral-500">{formatExpiry(expiresAt)}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Brand footer**

Create `src/components/public-share/brand-footer.tsx`:
```tsx
export function BrandFooter() {
  return (
    <div className="flex items-center justify-center gap-1.5 px-4 py-2 border-t border-neutral-100">
      <span className="text-[10px] text-neutral-400">Shared via</span>
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 bg-neutral-900 rounded-sm" />
        <span className="text-[11px] font-semibold text-neutral-600">S3 Dock</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace the landing card stub with the fallback layout**

Replace `src/components/public-share/landing-card.tsx`:
```tsx
import type { ShareLink, Connection } from "@/generated/prisma/client";
import { BrandHeader } from "./brand-header";
import { BrandFooter } from "./brand-footer";

type Props = {
  link: ShareLink & { connection: Connection };
  teamLabel?: string;
};

function basename(key: string): string {
  return key.split("/").pop() ?? key;
}

function formatBytes(n: number | null): string | null {
  if (n === null) return null;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export function LandingCard({ link, teamLabel = "S3 Dock" }: Props) {
  const filename = basename(link.key);
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-neutral-50">
      <div className="bg-white rounded-xl shadow-md overflow-hidden max-w-md w-full">
        <BrandHeader teamLabel={teamLabel} expiresAt={link.expiresAt} />
        <div className="px-4 py-8 text-center">
          <div className="w-14 h-14 mx-auto mb-3 bg-neutral-100 rounded-lg flex items-center justify-center text-xs text-neutral-600 font-semibold">
            {filename.split(".").pop()?.toUpperCase() ?? "FILE"}
          </div>
          <div className="text-sm font-semibold text-neutral-900">{filename}</div>
          <div className="text-xs text-neutral-500 mt-1">
            shared by {link.createdByDisplayName}
          </div>
        </div>
        <div className="px-4 pb-4">
          {link.description && (
            <div className="text-sm text-neutral-700 italic bg-neutral-50 rounded-md px-3 py-2 border-l-2 border-neutral-900 mb-3">
              {link.description}
            </div>
          )}
          <a
            href={`/s/${link.slug}/download`}
            className="block w-full bg-neutral-900 text-white text-center rounded-md py-2.5 text-sm font-medium"
          >
            Download
          </a>
        </div>
        <BrandFooter />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Compute the `teamLabel` in `page.tsx`**

In `src/app/(public)/s/[slug]/page.tsx`, replace the `getShareLinkBySlug` call's include to pull the team name, then derive the label.

First update `src/lib/db/share-links.ts` — modify `getShareLinkBySlug` to include the workspace+team:
```ts
export async function getShareLinkBySlug(slug: string) {
  return prisma.shareLink.findUnique({
    where: { slug },
    include: {
      connection: {
        include: {
          workspace: {
            include: { team: true },
          },
        },
      },
    },
  });
}
```
Update the test for `getShareLinkBySlug` to match the new `include`.

In `page.tsx`:
```tsx
const teamLabel =
  link.connection.workspace.team?.name ??
  (link.connection.workspace.type === "PERSONAL" ? "Personal workspace" : "S3 Dock");

// ...
return <LandingCard link={link} teamLabel={teamLabel} />;
```

- [ ] **Step 5: Manual test**

Visit the share link. Expected: top brand bar, file card, download button, S3 Dock footer.

- [ ] **Step 6: Commit**

```bash
git add src/components/public-share/ src/app/(public)/s/[slug]/page.tsx src/lib/db/share-links.ts src/lib/db/share-links.test.ts
git commit -m "feat(share-links): branded landing card with fallback layout"
```

---

### Task 17: Inline preview bodies (image / pdf / video / audio / text)

**Files:**
- Modify: `src/components/public-share/landing-card.tsx`
- Modify: `src/app/(public)/s/[slug]/page.tsx` (to pass a 5min presigned URL for inline preview)

- [ ] **Step 1: Generate a 5-minute presigned URL in `page.tsx`**

In `src/app/(public)/s/[slug]/page.tsx`, after status checks and password check but before rendering `<LandingCard>`, build a preview URL. Add:
```tsx
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client } from "@/lib/s3/client";
import { decrypt } from "@/lib/crypto";

// ... inside the component, after password check:
const previewClient = createS3Client({
  ...link.connection,
  secretAccessKey: decrypt(link.connection.secretAccessKey),
});
const previewUrl = await getSignedUrl(
  previewClient,
  new GetObjectCommand({ Bucket: link.bucket, Key: link.key }),
  { expiresIn: 5 * 60 }
);

return <LandingCard link={link} teamLabel={teamLabel} previewUrl={previewUrl} />;
```

- [ ] **Step 2: Add mime-type heuristic + body renderers in `landing-card.tsx`**

Extend `src/components/public-share/landing-card.tsx` to choose a body by extension. Replace the body section:
```tsx
type Props = {
  link: ShareLink & { connection: Connection };
  teamLabel?: string;
  previewUrl: string;
};

function inferMime(key: string): "image" | "video" | "audio" | "pdf" | "text" | "other" {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "log", "json", "yml", "yaml", "csv", "html", "css", "js", "ts"].includes(ext))
    return "text";
  return "other";
}

function PreviewBody({ kind, url, filename }: { kind: ReturnType<typeof inferMime>; url: string; filename: string }) {
  if (kind === "image")
    return <img src={url} alt={filename} className="w-full max-h-[400px] object-contain bg-neutral-50" />;
  if (kind === "video")
    return <video src={url} controls className="w-full max-h-[400px] bg-black" />;
  if (kind === "audio")
    return (
      <div className="p-6 bg-neutral-50 flex justify-center">
        <audio src={url} controls className="w-full max-w-sm" />
      </div>
    );
  if (kind === "pdf")
    return <iframe src={url} title={filename} className="w-full h-[500px] bg-neutral-100" />;
  // text/other → no inline preview here (fallback icon-card layout below)
  return null;
}

export function LandingCard({ link, teamLabel = "S3 Dock", previewUrl }: Props) {
  const filename = basename(link.key);
  const kind = inferMime(link.key);
  const inline = kind !== "other" && kind !== "text" ? (
    <PreviewBody kind={kind} url={previewUrl} filename={filename} />
  ) : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-neutral-50">
      <div className="bg-white rounded-xl shadow-md overflow-hidden max-w-2xl w-full">
        <BrandHeader teamLabel={teamLabel} expiresAt={link.expiresAt} />

        {inline ? (
          inline
        ) : (
          <div className="px-4 py-8 text-center">
            <div className="w-14 h-14 mx-auto mb-3 bg-neutral-100 rounded-lg flex items-center justify-center text-xs text-neutral-600 font-semibold">
              {filename.split(".").pop()?.toUpperCase() ?? "FILE"}
            </div>
            <div className="text-sm font-semibold text-neutral-900">{filename}</div>
            <div className="text-xs text-neutral-500 mt-1">
              shared by {link.createdByDisplayName}
            </div>
          </div>
        )}

        <div className="px-4 py-3">
          {inline && (
            <div className="text-sm font-semibold text-neutral-900 mb-1">{filename}</div>
          )}
          {inline && (
            <div className="text-xs text-neutral-500 mb-3">
              shared by {link.createdByDisplayName}
            </div>
          )}
          {link.description && (
            <div className="text-sm text-neutral-700 italic bg-neutral-50 rounded-md px-3 py-2 border-l-2 border-neutral-900 mb-3">
              {link.description}
            </div>
          )}
          <a
            href={`/s/${link.slug}/download`}
            className="block w-full bg-neutral-900 text-white text-center rounded-md py-2.5 text-sm font-medium"
          >
            Download
          </a>
        </div>

        <BrandFooter />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Manual test with different file types**

Create three share links — one image, one pdf, one video. Visit each, confirm inline preview renders for image/video/pdf and the fallback card renders for, e.g., `.tar.gz`.

- [ ] **Step 4: Commit**

```bash
git add src/components/public-share/landing-card.tsx src/app/(public)/s/[slug]/page.tsx
git commit -m "feat(share-links): inline preview for image/pdf/video/audio"
```

---

### Task 18: React Query hooks for share-links

**Files:**
- Modify: `src/lib/queries/keys.ts`
- Create: `src/lib/queries/share-links.ts`

- [ ] **Step 1: Add query keys**

In `src/lib/queries/keys.ts`, add a `shareLinks` factory matching the existing `notes` / `bookmarks` shape (using `all: [...] as const` then spreading it from sub-keys):
```ts
shareLinks: {
  all: ["share-links"] as const,
  list: (connectionId: string, bucket?: string, key?: string) =>
    [...queryKeys.shareLinks.all, "list", connectionId, bucket ?? "", key ?? ""] as const,
  detail: (id: string) =>
    [...queryKeys.shareLinks.all, "detail", id] as const,
},
```
Add this entry alongside the existing `notes`, `bookmarks`, etc.

- [ ] **Step 2: Implement hooks**

Create `src/lib/queries/share-links.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";

export type ShareLinkResponse = {
  id: string;
  slug: string;
  bucket: string;
  key: string;
  createdById: string | null;
  createdByDisplayName: string;
  createdByImageUrl: string | null;
  expiresAt: string | null;
  hasPassword: boolean;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  description: string | null;
  createdAt: string;
  status: "active" | "expired" | "exhausted" | "revoked";
};

export function useShareLinks(
  connectionId: string,
  filter?: { bucket?: string; key?: string }
) {
  return useQuery({
    queryKey: queryKeys.shareLinks.list(connectionId, filter?.bucket, filter?.key),
    enabled: !!connectionId,
    queryFn: async () => {
      const sp = new URLSearchParams({ connectionId });
      if (filter?.bucket) sp.set("bucket", filter.bucket);
      if (filter?.key) sp.set("key", filter.key);
      const r = await fetch(`/api/share-links?${sp.toString()}`);
      if (!r.ok) throw new Error("Failed to load share links");
      const data = (await r.json()) as { shareLinks: ShareLinkResponse[] };
      return data.shareLinks;
    },
  });
}

export type CreateInput = {
  connectionId: string;
  bucket: string;
  key: string;
  expiresIn?: number | null;
  password?: string | null;
  maxUses?: number | null;
  description?: string | null;
};

export function useCreateShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInput) => {
      const r = await fetch("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw new Error("Failed to create share link");
      return (await r.json()) as { shareLink: ShareLinkResponse; url: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.shareLinks.all });
    },
  });
}

export function useRevokeShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/share-links/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to revoke share link");
      return (await r.json()) as { revokedAt: string | null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.shareLinks.all });
    },
  });
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
pnpm tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/keys.ts src/lib/queries/share-links.ts
git commit -m "feat(share-links): react-query hooks"
```

---

### Task 19: ShareDialog component

**Files:**
- Create: `src/components/shares/share-dialog.tsx`

- [ ] **Step 1: Build the dialog**

Create `src/components/shares/share-dialog.tsx`:
```tsx
"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useShareLinks,
  useCreateShareLink,
  useRevokeShareLink,
  type ShareLinkResponse,
} from "@/lib/queries/share-links";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  bucket: string;
  fileKey: string;
};

const EXPIRY_OPTIONS = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 60 * 60 * 24 },
  { label: "7 days", seconds: 60 * 60 * 24 * 7 },
  { label: "30 days", seconds: 60 * 60 * 24 * 30 },
  { label: "90 days", seconds: 60 * 60 * 24 * 90 },
  { label: "Never", seconds: 0 },
];

export function ShareDialog({ open, onOpenChange, connectionId, bucket, fileKey }: Props) {
  const existing = useShareLinks(connectionId, { bucket, key: fileKey });
  const create = useCreateShareLink();
  const revoke = useRevokeShareLink();

  const [expirySec, setExpirySec] = useState(EXPIRY_OPTIONS[2].seconds);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [useCap, setUseCap] = useState(false);
  const [maxUses, setMaxUses] = useState(5);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<{ url: string; shareLink: ShareLinkResponse } | null>(null);

  async function handleCreate() {
    const result = await create.mutateAsync({
      connectionId,
      bucket,
      key: fileKey,
      expiresIn: expirySec > 0 ? expirySec : null,
      password: usePassword && password ? password : null,
      maxUses: useCap ? maxUses : null,
      description: message.trim() || null,
    });
    setCreated(result);
  }

  function reset() {
    setCreated(null);
    setPassword("");
    setMessage("");
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl p-6 w-[440px] max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="text-sm font-semibold mb-1">
            Share {fileKey.split("/").pop()}
          </Dialog.Title>
          <Dialog.Description className="text-xs text-neutral-500 mb-4">
            {bucket} / {fileKey}
          </Dialog.Description>

          {existing.data && existing.data.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-neutral-500 mb-2">
                Existing shares ({existing.data.length})
              </div>
              <ul className="space-y-1">
                {existing.data.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">
                      {s.createdByDisplayName} · {s.useCount} views · {s.status}
                    </span>
                    <button
                      className="text-neutral-600 hover:text-neutral-900"
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/s/${s.slug}`)}
                    >copy</button>
                    {s.status === "active" && (
                      <button
                        className="text-red-600 hover:text-red-700"
                        onClick={() => revoke.mutate(s.id)}
                      >revoke</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!created ? (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-neutral-700">
                Expires
                <select
                  value={expirySec}
                  onChange={(e) => setExpirySec(Number(e.target.value))}
                  className="block w-full mt-1 border border-neutral-300 rounded-md px-2 py-1.5 text-sm"
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.label} value={o.seconds}>{o.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-xs text-neutral-700">
                <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
                Password protect
              </label>
              {usePassword && (
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full border border-neutral-300 rounded-md px-2 py-1.5 text-sm"
                />
              )}

              <label className="flex items-center gap-2 text-xs text-neutral-700">
                <input type="checkbox" checked={useCap} onChange={(e) => setUseCap(e.target.checked)} />
                Limit to
                {useCap && (
                  <input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(Number(e.target.value))}
                    className="w-16 border border-neutral-300 rounded-md px-2 py-0.5 text-xs"
                  />
                )}
                downloads
              </label>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional message"
                rows={2}
                className="w-full border border-neutral-300 rounded-md px-2 py-1.5 text-sm"
              />

              <button
                onClick={handleCreate}
                disabled={create.isPending}
                className="w-full bg-neutral-900 text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
              >
                {create.isPending ? "Creating…" : "Create share"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-neutral-500">Share link created.</div>
              <div className="flex items-center gap-2 bg-neutral-100 rounded-md px-3 py-2">
                <code className="flex-1 text-xs truncate">{created.url}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(created.url)}
                  className="text-xs font-medium bg-neutral-900 text-white rounded px-2 py-1"
                >Copy</button>
              </div>
              <div className="text-xs text-neutral-500">0 views yet.</div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm tsc --noEmit
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/shares/share-dialog.tsx
git commit -m "feat(share-links): share dialog component"
```

---

### Task 20: Entry points — context menu, bulk-ops, preview modal

**Files:**
- Modify: `src/components/browser/file-row.tsx`
- Modify: `src/components/browser/file-tile.tsx`
- Modify: `src/components/browser/bulk-ops-panel.tsx`
- Modify: `src/components/preview/file-preview-modal.tsx`

- [ ] **Step 1: Read each file**

Read each of the four files to locate the existing context menu / toolbar arrays so the "Share..." item is added in the right place using the existing pattern (icon, label, onClick).

- [ ] **Step 2: Add "Share..." to row context menu**

In `src/components/browser/file-row.tsx`, find the right-click context menu definition (probably an array of items rendered through a `<ContextMenu>` from Radix or a local dropdown). Add a new entry:
```tsx
import { Link2 } from "lucide-react";
import { ShareDialog } from "@/components/shares/share-dialog";
// ... inside the component, add state:
const [shareOpen, setShareOpen] = useState(false);
// ... add menu item:
{ icon: Link2, label: "Share...", onClick: () => setShareOpen(true) }
// ... after the menu's JSX, render the dialog:
<ShareDialog
  open={shareOpen}
  onOpenChange={setShareOpen}
  connectionId={connectionId}
  bucket={bucket}
  fileKey={item.key}
/>
```
Repeat the equivalent in `file-tile.tsx` (it uses the same `<ContextMenu>` pattern).

- [ ] **Step 3: Add "Share" to bulk-ops panel with batchId fan-out**

In `src/components/browser/bulk-ops-panel.tsx`, add a "Share" button next to the existing bulk actions. On click:
```tsx
"use client";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { useCreateShareLink } from "@/lib/queries/share-links";

// ... inside the component:
const create = useCreateShareLink();
const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

async function shareAll() {
  const items = selectedItems; // existing local state
  setProgress({ done: 0, total: items.length });
  const batchId = crypto.randomUUID();
  // 5-at-a-time concurrency
  const queue = [...items];
  const workers = Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await create.mutateAsync({
        connectionId,
        bucket,
        key: item.key,
        // batchId is just metadata for activity; the API doesn't accept it yet —
        // see Task 21 to wire it through.
        description: null,
        expiresIn: 60 * 60 * 24 * 7,
        password: null,
        maxUses: null,
      });
      setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
    }
  });
  await Promise.all(workers);
  setProgress(null);
}
```
Add a button rendering this. Show `progress` while running.

- [ ] **Step 4: Add share icon to file-preview-modal toolbar**

In `src/components/preview/file-preview-modal.tsx`, add a share button in the toolbar that opens the `<ShareDialog>` for the currently-previewed file (same pattern as Step 2 — state + dialog mount).

- [ ] **Step 5: Manual test**

Run dev. Right-click a row → "Share..." opens the dialog. Tile view: same. Multi-select 3 files → bulk "Share" creates 3 links and shows progress. Open a file in preview → toolbar share icon opens the dialog.

- [ ] **Step 6: Commit**

```bash
git add src/components/browser/file-row.tsx src/components/browser/file-tile.tsx src/components/browser/bulk-ops-panel.tsx src/components/preview/file-preview-modal.tsx
git commit -m "feat(share-links): entry points in row, tile, bulk, preview"
```

---

### Task 21: Wire `batchId` through API + activity feed for bulk share

**Files:**
- Modify: `src/app/api/share-links/route.ts`
- Modify: `src/lib/db/activity.ts`
- Modify: `src/lib/queries/share-links.ts`

- [ ] **Step 1: Update create handler to accept and forward `batchId`**

In `src/app/api/share-links/route.ts`, accept `batchId` from the request body and pass it to the activity write. Replace the `recordActivity` call inside `POST` with a small helper that includes `batchId` directly (recordActivity sets it to null today). Add a new helper to activity.ts:
```ts
// in src/lib/db/activity.ts
export async function recordActivityWithBatch(
  input: SingleActivityInput & { batchId?: string | null }
): Promise<void> {
  try {
    await prisma.activityEvent.create({
      data: {
        connectionId: input.connectionId,
        userId: input.userId,
        userDisplayName: input.userDisplayName,
        userImageUrl: input.userImageUrl,
        action: input.action,
        bucket: input.bucket,
        key: input.key,
        targetKey: input.targetKey,
        byteSize: input.byteSize,
        batchId: input.batchId ?? null,
      },
    });
  } catch (err) {
    console.error("[activity] recordActivityWithBatch failed:", err);
  }
}
```
Use `recordActivityWithBatch` in the share POST handler:
```ts
await recordActivityWithBatch({
  connectionId,
  userId: user.id,
  userDisplayName: displayName(user),
  userImageUrl: user.imageUrl ?? null,
  action: "SHARE_CREATED",
  bucket,
  key,
  batchId: typeof body.batchId === "string" ? body.batchId : null,
});
```
Do the same in DELETE (`src/app/api/share-links/[id]/route.ts`) — accept an optional `batchId` query param (revoke-all-from-a-batch is a v2 thing, but pass-through wiring is cheap).

- [ ] **Step 2: Pass `batchId` from the bulk fan-out**

Update `CreateInput` in `src/lib/queries/share-links.ts` to include `batchId?: string`. Update `useCreateShareLink`'s `mutationFn` to forward it.

Then in `bulk-ops-panel.tsx`, pass `batchId` on every call from the bulk fan-out loop.

- [ ] **Step 3: Type-check + manual**

Run `pnpm tsc --noEmit`. Manually share 3 files via bulk, then check the activity feed groups them as one batch.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/share-links/ src/lib/db/activity.ts src/lib/queries/share-links.ts src/components/browser/bulk-ops-panel.tsx
git commit -m "feat(share-links): wire batchId through bulk share fan-out"
```

---

### Task 22: Manage page + sidebar entry

**Files:**
- Create: `src/app/(dashboard)/shares/page.tsx`
- Create: `src/components/shares/share-list-table.tsx`
- Modify: `src/components/shared/app-sidebar.tsx`

- [ ] **Step 1: Read the sidebar file**

Read `src/components/shared/app-sidebar.tsx` to understand the nav-item pattern (icon, label, href).

- [ ] **Step 2: Add "Shares" nav item**

In `src/components/shared/app-sidebar.tsx`, add a nav entry alongside Activity/Bookmarks:
```tsx
import { Link2 } from "lucide-react";
// inside the nav items list:
{ icon: Link2, label: "Shares", href: "/shares" },
```

- [ ] **Step 3: Build the table component**

Create `src/components/shares/share-list-table.tsx`:
```tsx
"use client";
import { useShareLinks, useRevokeShareLink, type ShareLinkResponse } from "@/lib/queries/share-links";

const STATUS_COLOR: Record<ShareLinkResponse["status"], string> = {
  active: "bg-green-100 text-green-800",
  expired: "bg-neutral-200 text-neutral-600",
  exhausted: "bg-amber-100 text-amber-800",
  revoked: "bg-red-100 text-red-700",
};

export function ShareListTable({ connectionId }: { connectionId: string }) {
  const { data, isLoading } = useShareLinks(connectionId);
  const revoke = useRevokeShareLink();

  if (isLoading) return <div className="text-sm text-neutral-500 p-4">Loading…</div>;
  if (!data || data.length === 0)
    return <div className="text-sm text-neutral-500 p-4">No share links yet.</div>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-neutral-500 uppercase">
        <tr>
          <th className="py-2 px-3">File</th>
          <th className="py-2 px-3">Bucket</th>
          <th className="py-2 px-3">Status</th>
          <th className="py-2 px-3">Uses</th>
          <th className="py-2 px-3">Expires</th>
          <th className="py-2 px-3">Created by</th>
          <th className="py-2 px-3"></th>
        </tr>
      </thead>
      <tbody>
        {data.map((s) => (
          <tr key={s.id} className="border-t border-neutral-100">
            <td className="py-2 px-3 truncate max-w-xs">{s.key}</td>
            <td className="py-2 px-3">{s.bucket}</td>
            <td className="py-2 px-3">
              <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLOR[s.status]}`}>{s.status}</span>
            </td>
            <td className="py-2 px-3">
              {s.useCount}{s.maxUses ? ` / ${s.maxUses}` : ""}
            </td>
            <td className="py-2 px-3 text-xs text-neutral-500">
              {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : "never"}
            </td>
            <td className="py-2 px-3 text-xs">{s.createdByDisplayName}</td>
            <td className="py-2 px-3 text-right space-x-2">
              <button
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/s/${s.slug}`)}
                className="text-xs text-neutral-600 hover:text-neutral-900"
              >copy</button>
              {s.status === "active" && (
                <button
                  onClick={() => revoke.mutate(s.id)}
                  className="text-xs text-red-600 hover:text-red-700"
                >revoke</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Build the page**

There's no `connection-store.ts` in this codebase (CLAUDE.md mentions one but it doesn't exist). The connection context comes from `tab-store.ts` (per-tab connection) or via URL. For v1, the manage page uses a URL search param (`?connection=<id>`) and renders a connection picker if none is set. This keeps the page deep-linkable and avoids coupling to tab state.

Create `src/app/(dashboard)/shares/page.tsx`:
```tsx
"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useConnections } from "@/lib/queries/connections";
import { ShareListTable } from "@/components/shares/share-list-table";

export default function SharesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selected = searchParams.get("connection") ?? "";
  const { data: connections } = useConnections();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Share links</h1>
        <select
          value={selected}
          onChange={(e) => {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set("connection", e.target.value);
            router.replace(`/shares?${sp.toString()}`);
          }}
          className="border border-neutral-300 rounded-md px-2 py-1 text-sm"
        >
          <option value="">Select a connection…</option>
          {connections?.map((c) => (
            <option key={c.id} value={c.id}>{c.name ?? c.endpoint}</option>
          ))}
        </select>
      </div>

      {selected ? (
        <ShareListTable connectionId={selected} />
      ) : (
        <div className="text-sm text-neutral-500">
          Choose a connection to view its share links.
        </div>
      )}
    </div>
  );
}
```
If `useConnections` doesn't exist at that exact path, read `src/lib/queries/` to find the actual hook name — based on the existing pattern it's likely there (e.g. `use-connections.ts` or inside an index). Use whatever lists connections accessible to the current user.

- [ ] **Step 5: Manual test**

Visit `/shares` with a connection selected; create a couple share links from the file browser; verify they appear. Click revoke; verify status flips to "revoked".

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/shares/ src/components/shares/share-list-table.tsx src/components/shared/app-sidebar.tsx
git commit -m "feat(share-links): manage page + sidebar entry"
```

---

### Task 23: Map SHARE_CREATED / SHARE_REVOKED in the activity feed UI

**Files:**
- Modify: `src/components/info-drawer/activity-tab.tsx`

The action-verb / action-label / known-action-list maps live in `activity-tab.tsx`. There are three exhaustive `Record<ActivityAction, string>` maps plus one `ALL_ACTIONS` array. Adding the new enum values without extending all three causes TypeScript errors (the records are exhaustive over the enum).

- [ ] **Step 1: Extend the three records and the action list**

In `src/components/info-drawer/activity-tab.tsx`:

Find `ACTION_VERBS` and add two entries:
```ts
const ACTION_VERBS: Record<ActivityAction, string> = {
  UPLOAD: "uploaded",
  DELETE: "deleted",
  COPY: "copied",
  MOVE: "moved",
  RENAME: "renamed",
  FOLDER_CREATE: "created folder",
  TAG_CHANGE: "updated tags on",
  BUCKET_CREATE: "created bucket",
  BUCKET_DELETE: "deleted bucket",
  SHARE_CREATED: "created a share link for",
  SHARE_REVOKED: "revoked share link for",
};
```

Find `ALL_ACTIONS` and append:
```ts
const ALL_ACTIONS: ActivityAction[] = [
  "UPLOAD",
  "DELETE",
  "COPY",
  "MOVE",
  "RENAME",
  "FOLDER_CREATE",
  "TAG_CHANGE",
  "BUCKET_CREATE",
  "BUCKET_DELETE",
  "SHARE_CREATED",
  "SHARE_REVOKED",
];
```

Find `ACTION_LABELS` and add:
```ts
const ACTION_LABELS: Record<ActivityAction, string> = {
  UPLOAD: "Upload",
  DELETE: "Delete",
  COPY: "Copy",
  MOVE: "Move",
  RENAME: "Rename",
  FOLDER_CREATE: "Folder create",
  TAG_CHANGE: "Tag change",
  BUCKET_CREATE: "Bucket create",
  BUCKET_DELETE: "Bucket delete",
  SHARE_CREATED: "Share created",
  SHARE_REVOKED: "Share revoked",
};
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm tsc --noEmit
```
Expected: succeeds (no exhaustiveness errors on `Record<ActivityAction, …>`).

- [ ] **Step 3: Manual test**

Trigger SHARE_CREATED and SHARE_REVOKED via the UI, open the activity tab in the info drawer, confirm both render with their new verbs and labels.

- [ ] **Step 4: Commit**

```bash
git add src/components/info-drawer/activity-tab.tsx
git commit -m "feat(share-links): activity feed labels for SHARE_CREATED/REVOKED"
```

---

### Task 24: Final manual test checklist

**Files:** none — manual verification only.

- [ ] **Step 1: End-to-end happy path**

Create a share link for an image. Open `/s/<slug>` in an incognito window. Verify: inline image preview, brand header with team name, S3 Dock footer, download button works.

- [ ] **Step 2: Password gate**

Create a share with password "test123". Open in incognito; password form renders. Submit "wrong" — see "Invalid password". Submit "test123" — bypass and see landing card. Reload — still bypassed (cookie set). Open the link in a different incognito session — password form again.

- [ ] **Step 3: Expiry**

Create a share with expiry 1 hour. PATCH it via API to set `expiresAt` to 1 minute ago. Reload `/s/<slug>` — "Link expired" card with 410.

- [ ] **Step 4: Download cap**

Create a share with `maxUses=2`. Download twice. Third attempt: "Link no longer available" with 410. Verify `use_count` in DB = 2.

- [ ] **Step 5: Revoke**

Create a share, copy URL, click "Revoke" in the manage page. Visit the URL — "Link revoked" card with 410. Verify `ActivityEvent` row `SHARE_REVOKED` exists.

- [ ] **Step 6: Bulk share**

In file browser, multi-select 5 files, click "Share". 5 links created. Activity feed shows them grouped under one batch.

- [ ] **Step 7: Slack unfurl**

Paste a share URL into Slack (or use https://opengraph.dev/). Confirm `og:title` shows the filename and `og:description` shows "Shared by … via S3 Dock".

- [ ] **Step 8: Rate limit**

Hit `/s/<slug>/unlock` (password-gated link) with wrong password 6× quickly from the same IP. 6th attempt: "Too many attempts" message.

- [ ] **Step 9: Slug timing flatten**

Hit `/s/aaaaaaaa` (very likely nonexistent) several times. Each response should take ≥50ms. (Eye-check: should not feel instant.)

- [ ] **Step 10: Run full test suite**

Run:
```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
```
Expected: all pass.

- [ ] **Step 11: Tag the milestone**

```bash
git tag share-links-v1
git log --oneline share-links-v1~24..share-links-v1
```

---

## Self-Review Notes

The author of this plan ran the following checks against the spec:

**Spec coverage:**
- v1 in-scope items (single-file shares, expiry, soft-revoke, password, view-cap, analytics, branded landing, inline preview) → Tasks 2, 8–11, 13–17, 19–20.
- Data model exactly matching the spec → Task 2.
- Three crypto primitives kept separate (AES-GCM/bcrypt/JWT) → Tasks 4–5 (new ones); existing `lib/crypto.ts` is untouched.
- Race-safe atomic increment via `$queryRaw` → Task 9 (function), Task 15 (caller).
- Rate-limit 5/IP/slug/hour via in-memory LRU → Task 7 (lib), Task 14 (caller).
- OG meta tags via Next.js metadata → Task 13 (`generateMetadata`).
- Public route group + middleware bypass → Task 12.
- Activity feed integration with `batchId` → Tasks 10, 21, 23.
- Three entry points (row context menu, bulk-ops, preview modal) + sidebar + manage page → Tasks 20, 22.
- Testing matrix: unit tests for pure helpers (Tasks 3–7), mocked-Prisma DB tests (Tasks 8–9), manual flow tests (Task 24).

**Known gaps the implementer should be aware of (intentional, per spec):**
- VIEW debounce per IP+UA: implemented as plain write in Task 13. The 5-min debounce is a v1.1 polish — left as a TODO inside the spec but not a v1 blocker.
- No automated test for the public flow (the spec mentions `page.test.ts` / `unlock/route.test.ts` / `download/route.test.ts`). Wiring App Router server components into vitest is non-trivial; tasked as v1.1 follow-up. v1 relies on the manual checklist in Task 24 for the public flow.
- Storybook / visual regression for landing card layouts — not in spec scope.

If you (the implementer) hit blockers, consult the spec at `docs/superpowers/specs/2026-06-04-share-links-design.md`. It owns the source of truth for any decision not detailed in a task.
