# S3 Dock Landing Page — Design Spec

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Goal:** A product-showcase landing page for S3 Dock that educates visitors on what the product does and how it feels to use, with sign-up as a friendly secondary CTA.

---

## 1. Summary

S3 Dock currently has no public landing page — `/` redirects straight to `/buckets`. This spec defines a cinematic, scroll-driven marketing page that showcases the product to a broad audience (anyone who uses S3-compatible storage) through video, scroll animations, parallax, and stylized in-product mockups.

**Decisions locked during brainstorming:**

| Decision | Choice |
|----------|--------|
| Primary goal | Product showcase & education (sign-up secondary) |
| Audience | Mixed — broadly anyone using S3 |
| Visual mood | Dark / geometric (Vercel / Linear adjacent) |
| Hero treatment | Video-led hero |
| Narrative structure | Cinematic narrative (problem → metaphor reveal → grouped power features → scale → CTA) |
| Accent color | Honey amber (`oklch(0.83 0.16 85)`) on a near-black canvas |
| Headline | "S3, finally usable." |

**Incremental note:** The page structure below is the target. Section demos/mocks will be fleshed out incrementally as the underlying features mature. Every section's mock is a self-contained, swappable component — a stylized fake can be replaced with a real screenshot or video later without touching layout.

---

## 2. Technical foundation

### Routing
- Today `src/app/page.tsx` redirects `/` → `/buckets`.
- Replace with middleware-driven behavior: **signed-out** users see the landing page at `/`; **signed-in** users redirect to `/buckets`.
- Landing lives at `src/app/(public)/page.tsx`, reusing the existing `(public)` layout (already prevents dark-mode flash via an inline script).

### Stack additions
- **Framer Motion** — entrance/exit, layout, gesture, and the bulk of scroll animations.
- **Native CSS `scroll-timeline` / `view()`** for scroll-linked parallax where supported; Framer Motion is the fallback. Progressive enhancement.
- **No new 3D / heavy animation libraries** — everything is achievable with CSS transforms + Framer Motion, keeping the public-page bundle lean.
- Page is **static (SSG)**. Client components only where motion requires them.

### Theme
- Landing is **dark by default**, overriding system preference for this route only (consistent cinematic feel). Dashboard chrome is untouched.
- **Note on the existing `(public)` layout:** its inline anti-flash script currently applies `dark` only when the OS prefers dark. The landing must force dark regardless. Resolve by forcing the `dark` class on the landing page itself (or a landing-scoped wrapper) rather than depending on the OS-preference script — so the public share route (`/s/[slug]`, the other `(public)` page) keeps its current OS-following behavior.
- New CSS variables, scoped to the landing:
  - `--accent-amber: oklch(0.83 0.16 85)`
  - `--accent-amber-glow: oklch(0.83 0.16 85 / 0.25)`
- Near-black canvas: `oklch(0.12 0 0)`. White text. Muted grey: `oklch(0.7 0 0)`.

### Performance & accessibility
- All scroll/entrance animations gated by `prefers-reduced-motion: reduce` → fall back to instant reveals (no motion).
- Hero video: lazy-loaded, muted autoplay only after an IntersectionObserver hit, with a poster image. `.mp4` + `.webm`.
- All tile animations run only while visible (IntersectionObserver) to save CPU.
- Targets: Lighthouse performance 95+, accessibility 100.

---

## 3. Page structure (top → bottom)

### Hero (full `100svh`)
- Faint geometric grid background; soft amber glow blooming from top-center.
- Floating nav: cube logo + "S3 Dock" wordmark (left); Features / Pricing / Docs / Sign in (right); small amber "Try free" button at the right edge. Auth-aware: swaps to "Open app" when signed in (read client-side via Clerk).
- Pill badge: `● Now in beta` (amber dot, soft glow).
- Headline: **"S3, finally usable."** ~64–80px Space Grotesk, tracking `-0.03em`, max two lines, ~50% width desktop.
- Subhead: "A modern web UI for S3, R2, MinIO, and anything else that speaks the protocol."
- CTA row: primary amber pill `Watch the demo ▶`; ghost outline `Try free →`.
- Below fold-line: 16:9 video tile (~70% width), `rounded-2xl`, amber shadow-glow, faux browser chrome (3 traffic-light dots), centered play button on frosted backdrop.
- **Motion:** on load, headline fades in with letter stagger, CTAs spring in, video tile rises 40px + fades. Continuous: amber glow pulses gently (~8s), grid intersections shimmer faintly. On scroll: video tile follows ~200px with slight scale-down + parallax, then releases. Click play → full-screen centered modal, frosted backdrop, unmuted playback, ESC to close.
- **Video asset:** expects `/public/demo/showcase.mp4` (+ `.webm`) and poster `/public/demo/poster.png`. If absent, play button still opens the modal with a placeholder; swap when the real video lands.

### §1 — "The AWS console wasn't built for humans" (before/after)
- Full-width, ~90vh. Animated diagonal divider (clip-path) that sweeps in on scroll.
- Left half: desaturated, slightly blurred AWS S3 console mock, grey tag "S3 console".
- Right half: clean S3 Dock screenshot/mock (file grid, breadcrumbs, sidebar), amber tag "S3 Dock".
- Overlaid headline (lower-left): **"The AWS console wasn't built for humans."** Subhead: "We built one that was."
- **Motion:** divider sweeps in; the two halves do reciprocal parallax (left drifts down ~30px, right up ~30px) on scroll.

### §2 — Drive metaphor reveal (second hero moment, sticky scroll-jack)
- Sticky, full-viewport. Background pinned while user scrolls through three beats. Total scroll duration ~150svh.
- Center stage: large realistic S3 Dock browser window (`<AppWindow>` shell + tab bar + sidebar + file grid), ~80% width desktop.
- Right column: scroll-pinned text that swaps per beat:
  - **Beat 1** — "Folders, not prefixes." (window shows breadcrumb navigation)
  - **Beat 2** — "Drag, don't `aws s3 cp`." (files drag across grid; upload toast appears)
  - **Beat 3** — "Search like you mean it." (⌘K opens, results stream in)
- **Tech:** `useScroll` + `useTransform` drive both the window's internal scene and the text column opacity/y. After beat 3, section releases to normal scroll.
- This is the most complex piece; build after motion primitives are proven.

### §3 — Power features bento
- Bento grid, 3-col desktop, stacks on mobile. 5 tiles, each demoing one feature in motion (each gated by IntersectionObserver). 1px white-5% borders; amber border-glow + slight scale on hover.
  - **Tall (2×1) — Split view:** two app panes; a file drags left→right on a ~4s loop; amber drop-indicator.
  - **Wide (1×2) — Tabs:** tab strip switching between three buckets every ~2.5s; file grid cross-fades.
  - **Square — Indexed search:** ⌘K palette, query typed letter-by-letter, results filter down; loops with varied queries ("invoice.pdf", "images from last week", "*.zip").
  - **Square — Versions:** versions sidebar with timestamped list, one entry highlighting amber.
  - **Wide (1×2) — Multi-account:** connection switcher dropdown opening, AWS / R2 / MinIO badges.

### §4 — "Move files between any two buckets" (cross-bucket transfer)
- Full-width dark section, two app windows at opposite corners connected by an animated arc/path.
- A file "packet" travels the arc source ("prod", top-left) → destination ("backup", bottom-right) with amber trailing glow + progress ring.
- Headline (left): **"Move files between any two buckets."** Subhead: "Across accounts, across providers, across regions. Drag in one window, drop in another."
- **Motion:** packet animation is scroll-scrubbed (forward sends, reverse rewinds). Windows drift apart slightly on scroll (parallax).

### §5 — "One client. Every S3." (compatibility + easy setup)
- Centered headline: **"One client. Every S3."**
- Provider logos: AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi, Ceph, + "any S3-compatible endpoint" chip. Default to a gentle horizontal marquee that pauses on hover.
- Compact "Connect in 30 seconds" mini-demo: a 3-field connection form (endpoint, key, secret) that auto-fills and shows "Connected ✓".
- **Motion:** logos fade/scale in with stagger on scroll.

### §6 — "Storage your whole team can actually use." (teams)
- Two-up: copy (left) + stacked-card demo (right).
- Demo cards cross-fade on a loop: share-link card (copyable URL + expiry toggle), team-members card (avatars + role badges), permissions card (read/write toggles).
- Headline: **"Storage your whole team can actually use."** Subhead: "Share links, granular permissions, and team workspaces — without handing out AWS keys."
- **Motion:** cards do a subtle 3D tilt parallax tied to scroll position.

### §7 — Pricing
- Headline: **"Simple pricing. No surprises."**
- 2–3 plan cards reflecting the **real** tiers from `2026-06-04-subscription-tiers-design.md` (pull actual names/prices during implementation; do not invent). Recommended plan: amber border + glow + "Most popular" pill.
- Monthly/annual toggle if the tiers support it.
- Each card: plan name, price, value line, amber-checkmark feature list, CTA.
- FAQ accordion below (4–6 items, e.g. "Do you store my files?", "Which providers work?", "Can I self-host?", "Is my data secure?").
- **Motion:** cards rise + fade in with stagger; recommended card slightly elevated.

### §8 — Final CTA
- Full-width, tall, centered. Strong amber glow bloom behind content.
- Headline: **"Stop fighting the console."** Subhead: "Connect your first bucket in under a minute."
- Primary amber CTA `Get started free →`; secondary ghost link "Watch the demo again".
- Optional: large faint cube logo behind text with slow parallax drift.

### Footer
- Structured footer on near-black. Columns: Product (Features, Pricing, Changelog) · Resources (Docs, Status, Blog) · Company (About, Contact) · Legal (Privacy, Terms).
- Bottom row: cube logo + "S3 Dock", copyright, social icons (GitHub, X).
- Subtle top border, muted text, amber link-hover.

---

## 4. Honesty constraint

Every section references **real** S3 Dock functionality — teams, shares, permissions, versions, health, command palette, split view, tabs, and multi-provider connections all exist in the codebase. The landing must not promise anything the app does not do. Mocks are stylized representations of real features, not aspirational fiction.

---

## 5. Component architecture

```
src/components/landing/
  landing-page.tsx          # composes all sections in order
  nav.tsx                   # floating nav + mobile menu (auth-aware)
  hero.tsx
  video-modal.tsx           # full-screen player
  problem-split.tsx         # §1 before/after
  metaphor-reveal.tsx       # §2 sticky scroll-jack
  feature-bento.tsx         # §3 + bento tiles
  transfer-arc.tsx          # §4 cross-bucket
  compatibility.tsx         # §5 providers + connect demo
  teams.tsx                 # §6
  pricing.tsx               # §7
  final-cta.tsx             # §8
  footer.tsx
  mocks/                    # stylized, swappable fake UIs
    app-window.tsx          # reusable faux-chrome shell (key swap point)
    file-grid.tsx
    command-palette-mock.tsx
    tab-strip-mock.tsx
    ...                     # added per-section as needed
  primitives/               # landing-only motion helpers
    reveal.tsx              # scroll-triggered fade/rise (respects reduced-motion)
    parallax.tsx            # scroll-linked Y transform
    glow.tsx                # amber bloom element
    grid-bg.tsx             # geometric grid background
```

### Shared primitives
- `<Reveal>` — fades + rises children when scrolled into view; respects reduced-motion.
- `<Parallax speed={...}>` — scroll-linked Y transform.
- `<Glow color tint>` — reusable amber bloom (hero, CTA, tiles).
- `<GridBg>` — geometric grid background.
- `<AppWindow>` — faux-browser-chrome shell every mock reuses (traffic lights, optional tab bar, sidebar slot). **This is the central swappability point** — replace its children with a real screenshot/video later without touching the surrounding layout.

### Design tokens (landing scope)
- Type: Space Grotesk (display/headings), Geist Mono (code/labels/badges). Both already loaded in the root layout.
- Spacing: generous; sections `py-32` desktop, large vertical rhythm.
- Radius: `rounded-2xl` / `rounded-3xl` for cards and the app window.

---

## 6. Data flow

- Page is **static (SSG)** — no live data; all mocks are hardcoded/animated client components.
- **Exception:** pricing reads tier config from the same source the app uses (shared constant) so prices stay in sync. If that coupling is awkward, fall back to hardcoded values mirrored from the subscription-tiers design doc.
- No new API routes, no DB reads.
- Auth state (signed-in?) read client-side via Clerk to swap nav CTA between "Sign in / Try free" and "Open app".

---

## 7. Testing

The project uses Vitest. The landing is presentational, so testing is light:
- Smoke test: `<LandingPage>` renders all section headings.
- Unit tests for non-trivial logic only — primarily the scroll-progress math in the metaphor-reveal hook.
- No heavy animation/visual-regression testing in scope.

---

## 8. Build order

1. **Foundation:** route/middleware change, theme tokens, motion primitives (`Reveal`, `Parallax`, `Glow`, `GridBg`), `<AppWindow>` shell.
2. **Hero** + nav + video modal.
3. **Sections top-to-bottom**, each independently shippable. Start with simpler sections (§1, §3, §5, §6); save the sticky scroll-jack (§2) and transfer arc (§4) for after primitives are proven.
4. **Pricing, final CTA, footer.**
5. **Polish pass:** reduced-motion verification, Lighthouse, responsive/mobile.

---

## 9. Out of scope

- The actual demo video production (placeholder until the real asset is delivered).
- Blog, docs, changelog, status pages (footer links can point to `#` or existing routes for now).
- A/B testing, analytics instrumentation, SEO beyond sensible defaults (title/description/OG tags).
- Any change to dashboard/app behavior beyond the `/` redirect logic.
