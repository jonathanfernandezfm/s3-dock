# Plan 017: Give the landing page a complete crawl/index/social metadata foundation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8d46baa..HEAD -- src/app/layout.tsx "src/app/(public)/page.tsx"`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx (technical SEO / discoverability)
- **Planned at**: commit `8d46baa`, 2026-06-21

## Why this matters

The marketing landing page (`/`) has good page-level metadata (title,
description, basic Open Graph) but is missing the entire site-level
crawl/index infrastructure: there is **no `metadataBase`** (so Next.js
cannot resolve Open Graph / canonical URLs to absolute and falls back to
`localhost` with a build-time warning), **no `robots.ts`**, **no
`sitemap.ts`**, **no Open Graph image** (link previews on Slack/X/LinkedIn
render blank), and **no structured data** (no `SoftwareApplication` /
`Organization` JSON-LD for rich results). These are small, self-contained,
low-risk additions that establish the foundation search engines and social
platforms expect. After this lands, the page resolves canonical URLs
correctly, exposes a sitemap + robots policy that keeps private routes out
of the index, renders a branded social preview, and emits valid structured
data.

This plan covers **only the invisible technical-SEO foundation**. It does
not change any visible copy, headings, or design, and it does not build new
content pages — those are deferred (see "Maintenance notes").

## Current state

Relevant files:

- `src/app/layout.tsx` — root layout; exports the site-wide `metadata`. No
  `metadataBase`. This is a Server Component.
- `src/app/(public)/page.tsx` — the landing route (`/`); exports page-level
  `metadata` and renders `<LandingPage />`. This is a Server Component.
- `src/app/(public)/s/[slug]/page.tsx` — **public file-share** route, marked
  `export const dynamic = "force-dynamic"` (line 13). This is per-user
  private content and **must be excluded from indexing** by robots.
- `src/components/landing/landing-page.tsx` — server component composing the
  landing sections.
- `src/components/landing/landing-page.test.tsx` — existing vitest test
  (jsdom env, mocks `@clerk/nextjs`). Use as the structural pattern for any
  component-level test.

Current root metadata — `src/app/layout.tsx:17-20`:

```ts
export const metadata: Metadata = {
  title: "S3 Dock",
  description: "A modern web UI for managing S3-compatible storage",
};
```

Current landing metadata — `src/app/(public)/page.tsx:4-14`:

```ts
export const metadata: Metadata = {
  title: "S3 Dock — S3, finally usable.",
  description:
    "A modern web UI for S3, R2, MinIO, and anything else that speaks the protocol. Browse, search, and move files like it's a drive.",
  openGraph: {
    title: "S3 Dock — S3, finally usable.",
    description:
      "A modern web UI for S3-compatible storage. Browse, search, and move files like it's a drive.",
    type: "website",
  },
};
```

Repo conventions to match:

- **Production domain**: the app refers to itself as `s3dock.app` (e.g.
  `mailto:hello@s3dock.app` in `src/components/landing/footer.tsx:25`, mock
  window titles `s3dock.app` in the landing components). Use
  `https://s3dock.app` as the canonical production URL, but make it
  overridable via the `NEXT_PUBLIC_APP_URL` environment variable so non-prod
  deploys can point elsewhere. There is **no existing base-URL env var** in
  the codebase — you are introducing this one; use it consistently across
  every file this plan touches.
- **No `typecheck` npm script exists.** Typecheck with
  `pnpm exec tsc --noEmit`. Lint is `pnpm lint` (`eslint src/`). Tests are
  `pnpm test` (`vitest run`).
- Next.js App Router file conventions: `robots.ts`, `sitemap.ts`, and
  `opengraph-image.tsx` are special files Next recognizes by name and path —
  exact filenames and locations matter.
- TypeScript, 2-space indent, double quotes (match the excerpts above).

## Commands you will need

| Purpose    | Command                          | Expected on success            |
|------------|----------------------------------|--------------------------------|
| Install    | `pnpm install`                   | exit 0                         |
| Typecheck  | `pnpm exec tsc --noEmit`         | exit 0, no errors              |
| Lint       | `pnpm lint`                      | exit 0 (no NEW problems)       |
| Tests      | `pnpm test`                      | all pass (incl. new tests)     |

Note: `pnpm lint` / `pnpm exec tsc --noEmit` may report **pre-existing**
problems unrelated to this plan (the repo has a known dirty baseline tracked
by plan 003). Success here means **no new** errors are introduced in the
files you touch — compare against a clean run on the same commit if unsure.

## Scope

**In scope** (the only files you may create or modify):

- `src/app/layout.tsx` (modify — add `metadataBase`)
- `src/app/(public)/page.tsx` (modify — canonical, twitter card, JSON-LD)
- `src/app/robots.ts` (create)
- `src/app/sitemap.ts` (create)
- `src/app/(public)/opengraph-image.tsx` (create)
- `src/app/robots.test.ts` (create)
- `src/app/sitemap.test.ts` (create)
- `.env.example` (modify — document `NEXT_PUBLIC_APP_URL`, only if the file exists)

**Out of scope** (do NOT touch, even though they look related):

- Any visible copy, headings, or component markup in
  `src/components/landing/**` — no H1/H2/title rewrites, no fixing the `#`
  placeholder footer links. Those are separate design/content decisions.
- `src/app/(public)/s/[slug]/**` — the share route keeps its own metadata;
  you only reference its path in robots `Disallow`, you do not edit it.
- The app/auth route groups (`src/app/app/**`, `src/app/(auth)/**`) — robots
  disallows their paths; do not add per-page metadata to them.
- `next.config.ts` — no config changes are required for any step here.

## Git workflow

- Branch: `advisor/017-landing-seo-foundation`.
- Commit per step or logical unit; the repo uses Conventional Commits
  (recent history: `fix(properties-drawer): …`, `docs: add top-level README`).
  Example: `feat(seo): add metadataBase, robots, sitemap, OG image and JSON-LD`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `metadataBase` to the root layout metadata

In `src/app/layout.tsx`, extend the existing `metadata` export so Next can
resolve relative Open Graph / canonical URLs to absolute. Keep the existing
`title` and `description` exactly as-is. Result shape:

```ts
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://s3dock.app"),
  title: "S3 Dock",
  description: "A modern web UI for managing S3-compatible storage",
};
```

Do not add a `title.template` — the landing page sets an absolute title and
a template would corrupt it.

**Verify**: `pnpm exec tsc --noEmit` → exit 0 (no new errors).

### Step 2: Create `src/app/robots.ts`

Allow crawling of public marketing pages; disallow the app, auth, and
private share routes; reference the sitemap. Use the App Router
`MetadataRoute.Robots` return type.

```ts
import type { MetadataRoute } from "next";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://s3dock.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app/", "/sign-in", "/sign-up", "/s/"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
```

`/s/` (the `force-dynamic` per-user file-share route) MUST be in `disallow` —
those are private links and must never be indexed.

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 3: Create `src/app/sitemap.ts`

List only the canonical, indexable public URL(s). Today that is just the
landing page `/`. Use `MetadataRoute.Sitemap`. Do **not** add `lastModified`
using `new Date()` if you can avoid a flaky value — omit `lastModified`
entirely (it is optional) to keep the output deterministic and testable.

```ts
import type { MetadataRoute } from "next";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://s3dock.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${baseUrl}/`,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
```

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 4: Create the Open Graph image at `src/app/(public)/opengraph-image.tsx`

Generate a branded 1200×630 social preview with `ImageResponse` from
`next/og` (pure code — no binary asset needed). Keep the design simple
(text on the dark brand background) to avoid external font loading. This
file lives at the `(public)` group level and therefore applies to `/` (and
cascades to nested public routes as a fallback, which is acceptable —
share pages are `noindex` and a branded fallback preview is harmless).

```tsx
import { ImageResponse } from "next/og";

export const alt = "S3 Dock — S3, finally usable.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0a0a0a",
          color: "white",
        }}
      >
        <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: "-0.03em" }}>
          S3, finally usable.
        </div>
        <div style={{ marginTop: 28, fontSize: 36, color: "#a1a1aa" }}>
          A modern web UI for S3, R2, MinIO, and anything that speaks the protocol.
        </div>
        <div style={{ marginTop: 56, fontSize: 30, color: "#f59e0b" }}>
          s3dock.app
        </div>
      </div>
    ),
    { ...size }
  );
}
```

**Verify**: `pnpm exec tsc --noEmit` → exit 0. If your environment can run a
full build, `pnpm build` should compile the `/opengraph-image` route without
error; if `pnpm build` is unavailable to you, typecheck is sufficient and you
should note in your report that the image was not render-verified.

### Step 5: Add canonical + Twitter card to the landing metadata

In `src/app/(public)/page.tsx`, extend the existing `metadata` export. Add a
self-referencing canonical and a Twitter summary-large-image card. The
`openGraph` image is supplied automatically by the file from Step 4, so you
do not list it explicitly — but you DO need an explicit `twitter` block for
the Twitter card. Keep the existing title/description/openGraph fields.

```ts
export const metadata: Metadata = {
  title: "S3 Dock — S3, finally usable.",
  description:
    "A modern web UI for S3, R2, MinIO, and anything else that speaks the protocol. Browse, search, and move files like it's a drive.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "S3 Dock — S3, finally usable.",
    description:
      "A modern web UI for S3-compatible storage. Browse, search, and move files like it's a drive.",
    type: "website",
    url: "/",
    siteName: "S3 Dock",
  },
  twitter: {
    card: "summary_large_image",
    title: "S3 Dock — S3, finally usable.",
    description:
      "A modern web UI for S3-compatible storage. Browse, search, and move files like it's a drive.",
  },
};
```

**Verify**: `pnpm exec tsc --noEmit` → exit 0.

### Step 6: Add `SoftwareApplication` + `Organization` JSON-LD to the landing page

`src/app/(public)/page.tsx` is a Server Component, so you can render a
`<script type="application/ld+json">` directly in its output. Render it
alongside `<LandingPage />`.

First read `src/components/landing/pricing.tsx` to confirm whether a **free
tier** exists. If a free tier is offered, include the `offers` block with
`"price": "0"`. If you cannot confirm a free price, **omit the `offers`
field entirely** rather than guessing a number.

Target shape for the page component:

```tsx
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  /* ...from Step 5... */
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "S3 Dock",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: "https://s3dock.app",
      description:
        "A modern web UI for S3, R2, MinIO, and anything else that speaks the protocol.",
      // Include offers ONLY if a free tier is confirmed in pricing.tsx:
      // offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@type": "Organization",
      name: "S3 Dock",
      url: "https://s3dock.app",
      logo: "https://s3dock.app/logo.png",
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingPage />
    </>
  );
}
```

**Verify**: `pnpm exec tsc --noEmit` → exit 0, and `pnpm lint` → no new
problems (note: `dangerouslySetInnerHTML` for JSON-LD is the standard,
accepted pattern; if a lint rule flags it, leave the code as-is and report
the rule name rather than disabling it broadly).

### Step 7: Document the new env var (only if `.env.example` exists)

If `.env.example` exists at the repo root, add a documented entry so the new
variable is discoverable:

```
# Absolute public base URL, used for canonical/OG/sitemap/robots.
# Defaults to https://s3dock.app when unset.
NEXT_PUBLIC_APP_URL=https://s3dock.app
```

If `.env.example` does not exist, skip this step (do not create it).

**Verify**: `git status` shows `.env.example` modified only if it already
existed.

## Test plan

Add two unit tests modeled on the repo's vitest style (plain
`describe`/`it`/`expect`, no jsdom needed since these are pure functions —
contrast with `src/components/landing/landing-page.test.tsx` which needs
`// @vitest-environment jsdom` for React). Default these to the Node
environment (omit the jsdom pragma).

`src/app/robots.test.ts` — cover:
- the returned object disallows each private prefix: `/app/`, `/sign-in`,
  `/sign-up`, `/s/`;
- `allow` includes `/`;
- `sitemap` ends with `/sitemap.xml`.

`src/app/sitemap.test.ts` — cover:
- exactly one entry is returned;
- its `url` ends with `/` and `priority` is `1`.

Example shape for `robots.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import robots from "./robots";

describe("robots", () => {
  it("disallows private routes and references the sitemap", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    const disallow = ([] as string[]).concat(rules.disallow ?? []);
    expect(disallow).toEqual(
      expect.arrayContaining(["/app/", "/sign-in", "/sign-up", "/s/"])
    );
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
```

Verification: `pnpm test` → all pass, including the 2 new test files.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0 (no new errors vs. a clean run on the
      same commit)
- [ ] `pnpm lint` introduces no new problems in the touched files
- [ ] `pnpm test` exits 0; `src/app/robots.test.ts` and
      `src/app/sitemap.test.ts` exist and pass
- [ ] `src/app/robots.ts`, `src/app/sitemap.ts`, and
      `src/app/(public)/opengraph-image.tsx` exist
- [ ] `src/app/layout.tsx` contains `metadataBase`
- [ ] `src/app/(public)/page.tsx` contains `alternates`, `twitter`, and an
      `application/ld+json` script
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 017 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `src/app/layout.tsx:17-20` or `src/app/(public)/page.tsx:4-14`
  does not match the "Current state" excerpts (the codebase has drifted).
- `next/og` / `ImageResponse` is unavailable or the
  `opengraph-image.tsx` route fails to typecheck/build — report it rather
  than swapping in a binary asset or removing the file.
- A verification command fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file (e.g. you find you
  need to edit `next.config.ts` or a landing component) — stop and report
  what you found.
- You cannot determine the production domain and `s3dock.app` appears wrong
  for this deploy — stop and ask rather than hardcoding a guess.

## Maintenance notes

For the human/agent who owns this after it lands:

- **Sitemap is static (just `/`).** When real public content pages are added
  (docs, blog, comparison/alternative pages, Privacy/Terms), add their URLs
  to `src/app/sitemap.ts` and remove the matching `Disallow` from robots if
  any. The `sitemap.test.ts` "exactly one entry" assertion will then need
  updating — that is expected.
- **`NEXT_PUBLIC_APP_URL`** is the single source of truth for the public base
  URL introduced here. Set it in the production environment; it falls back to
  `https://s3dock.app`. If the production domain changes, set this var rather
  than editing the four files that read it.
- **OG image cascade**: `(public)/opengraph-image.tsx` also serves as the
  fallback OG image for `/s/[slug]` share pages (which are `noindex`). If a
  share-specific preview is ever wanted, add an `opengraph-image` at the
  share segment to override.
- A reviewer should confirm with Google's Rich Results Test and a social
  card validator **after deploy** (these need the live URL; they can't be
  checked from source).

### Deliberately deferred (NOT in this plan — separate decisions/effort)

These came from the same SEO audit but are intentionally excluded:

- Building indexable **content** (docs, blog, comparison/"alternatives"
  pages) — the biggest long-term organic lever, but a content/product effort,
  not a metadata change.
- Real **Privacy / Terms / About** pages and fixing the `#` placeholder
  footer links (`src/components/landing/footer.tsx`) — trust/E-E-A-T, but a
  content decision.
- On-page **copy** tweaks: adding a section `<h2>` to the metaphor-reveal
  block (currently jumps H1→H3) and folding more head keywords into the
  `<title>` — these change visible/brand copy and should be the owner's call.
- **Core Web Vitals** work (the landing ships heavy `motion/react` client
  JS) — needs measurement against the deployed URL via PageSpeed Insights
  first; relates to plan 008's virtualization work conceptually but is a
  distinct landing-page concern.
