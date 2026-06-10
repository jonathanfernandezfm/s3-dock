# S3 Dock Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cinematic, scroll-driven public landing page for S3 Dock defined in `docs/superpowers/specs/2026-06-09-landing-page-design.md`.

**Architecture:** A static landing page at `/` (route group `(public)`), composed of self-contained section components under `src/components/landing/`. Shared motion primitives (`Reveal`, `Parallax`, `Glow`, `GridBg`) and a reusable faux-app-window shell (`AppWindow`) keep sections consistent and mocks swappable. Auth-aware behavior happens at the edge (`src/proxy.ts` redirects signed-in users to `/buckets`) and in the nav (Clerk `<SignedIn>`/`<SignedOut>`).

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS 4, `motion` (Framer Motion successor, imported from `motion/react`), Radix Dialog (already a dependency), Clerk, Vitest + jsdom + React Testing Library for tests.

**Key spec decisions this plan implements:**
- Dark-only landing, forced via a `dark landing` wrapper class (does NOT touch the OS-preference script used by `/s/[slug]`).
- Amber accent: `--accent-amber: oklch(0.83 0.16 85)`.
- Headline: "S3, finally usable." (word-level stagger — letter-level causes kerning artifacts).
- No monthly/annual pricing toggle: the app has no annual price (`plans-modal.tsx` shows $0 / $4/mo / Custom). Spec said "toggle if the tiers support it" — they don't.
- Demo video assets (`/public/demo/showcase.mp4`, `.webm`, `poster.png`) do not exist yet. All code degrades gracefully (CSS-gradient poster, "Demo video coming soon." fallback in the modal).
- Every section's mock is honest: it represents features that exist in the codebase (split view, tabs, command palette search, versions, share links, teams, permissions, multi-provider connections).

---

## File Structure

```
src/
  proxy.ts                                   # MODIFY: make "/" public, redirect signed-in → /buckets
  app/
    page.tsx                                 # DELETE (currently redirects / → /buckets)
    globals.css                              # MODIFY: append landing-scoped vars + keyframes
    (public)/
      page.tsx                               # CREATE: landing route + metadata
  lib/
    landing/
      scroll-beats.ts                        # CREATE: pure scroll→beat math (TDD)
      scroll-beats.test.ts                   # CREATE
    subscriptions/
      plan-display.ts                        # CREATE: shared plan-card data
  components/
    billing/plans-modal.tsx                  # MODIFY: consume plan-display.ts (DRY)
    landing/
      landing-page.tsx                       # CREATE: composes all sections
      landing-page.test.tsx                  # CREATE: jsdom smoke test
      nav.tsx                                # CREATE
      hero.tsx                               # CREATE
      video-modal.tsx                        # CREATE
      problem-split.tsx                      # CREATE  §1
      metaphor-reveal.tsx                    # CREATE  §2 (sticky scroll-jack)
      feature-bento.tsx                      # CREATE  §3
      transfer-arc.tsx                       # CREATE  §4
      compatibility.tsx                      # CREATE  §5
      teams.tsx                              # CREATE  §6
      pricing.tsx                            # CREATE  §7
      final-cta.tsx                          # CREATE  §8
      footer.tsx                             # CREATE
      mocks/
        app-window.tsx                       # CREATE: faux chrome shell (swap point)
        file-grid.tsx                        # CREATE
        command-palette-mock.tsx             # CREATE
      primitives/
        reveal.tsx                           # CREATE
        parallax.tsx                         # CREATE
        glow.tsx                             # CREATE
        grid-bg.tsx                          # CREATE
        use-loop.ts                          # CREATE
vitest.config.ts                             # MODIFY: include .test.tsx
```

Conventions used throughout:
- Tabs for indentation in `.tsx`/`.ts` files? **No** — this repo uses tabs in `package.json` but spaces in `src/` — match existing `src/` style (2-space? check any file: `plans-modal.tsx` uses 2 spaces). Use **2 spaces**.
- `cn()` from `@/lib/utils` for conditional classes.
- Amber via CSS vars: `bg-[var(--accent-amber)]`, `text-[var(--accent-amber)]`, `shadow-[0_0_60px_var(--accent-amber-glow)]`.
- Every motion-bearing component is `"use client"`. `landing-page.tsx` and pure-markup components (`grid-bg`, `app-window`, `file-grid`, `footer`) stay server-compatible.

---

### Task 1: Dependencies + test tooling

**Files:**
- Modify: `package.json` (via pnpm)
- Modify: `vitest.config.ts`

- [ ] **Step 1: Install the animation library and test deps**

Run:
```bash
pnpm add motion && pnpm add -D jsdom @testing-library/react
```
Expected: `motion` appears in `dependencies`, `jsdom` and `@testing-library/react` in `devDependencies`, lockfile updated, no peer-dependency errors (motion v12+ supports React 19).

- [ ] **Step 2: Allow `.test.tsx` files in vitest**

Replace the `include` line in `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Default environment stays `node`; the smoke test opts into jsdom with a `// @vitest-environment jsdom` pragma so existing tests are untouched.

- [ ] **Step 3: Verify existing tests still pass**

Run: `pnpm test`
Expected: all existing tests pass (same count as before this task).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore(landing): add motion + jsdom test tooling"
```

---

### Task 2: Landing theme tokens + scroll-beat math (TDD)

**Files:**
- Modify: `src/app/globals.css` (append at end of file)
- Create: `src/lib/landing/scroll-beats.ts`
- Test: `src/lib/landing/scroll-beats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/landing/scroll-beats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getBeat } from "./scroll-beats";

describe("getBeat", () => {
  it("returns the first beat at progress 0", () => {
    expect(getBeat(0, 3)).toEqual({ index: 0, local: 0 });
  });

  it("maps mid-progress to the middle beat with local progress", () => {
    expect(getBeat(0.5, 3)).toEqual({ index: 1, local: 0.5 });
  });

  it("returns the last beat fully played at progress 1", () => {
    expect(getBeat(1, 3)).toEqual({ index: 2, local: 1 });
  });

  it("clamps out-of-range progress", () => {
    expect(getBeat(-0.5, 3)).toEqual({ index: 0, local: 0 });
    expect(getBeat(1.5, 3)).toEqual({ index: 2, local: 1 });
  });

  it("throws when beatCount is not positive", () => {
    expect(() => getBeat(0.5, 0)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- scroll-beats`
Expected: FAIL — `Cannot find module './scroll-beats'` (or equivalent).

- [ ] **Step 3: Implement `getBeat`**

Create `src/lib/landing/scroll-beats.ts`:

```ts
export interface BeatState {
  /** Which beat is active (0-based). */
  index: number;
  /** Progress within the active beat, 0..1. */
  local: number;
}

/**
 * Maps overall scroll progress (0..1) onto N sequential "beats".
 * Used by the sticky metaphor-reveal section to decide which scene
 * is on stage and how far through it we are.
 */
export function getBeat(progress: number, beatCount: number): BeatState {
  if (beatCount <= 0) {
    throw new Error("beatCount must be positive");
  }
  const clamped = Math.min(Math.max(progress, 0), 1);
  const scaled = clamped * beatCount;
  const index = Math.min(Math.floor(scaled), beatCount - 1);
  return { index, local: scaled - index };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- scroll-beats`
Expected: PASS, 5 tests.

- [ ] **Step 5: Append landing tokens + keyframes to globals.css**

Append to the END of `src/app/globals.css` (after the existing `@layer base` block):

```css
/* ---------- Landing page (scoped to .landing) ---------- */

.landing {
  --accent-amber: oklch(0.83 0.16 85);
  --accent-amber-glow: oklch(0.83 0.16 85 / 0.25);
  --landing-bg: oklch(0.12 0 0);
  --landing-muted: oklch(0.7 0 0);
}

@keyframes landing-glow-pulse {
  0%,
  100% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
}

@keyframes landing-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

.landing .animate-glow-pulse {
  animation: landing-glow-pulse 8s ease-in-out infinite;
}

.landing .animate-marquee {
  animation: landing-marquee 35s linear infinite;
}

.landing .marquee-group:hover .animate-marquee {
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .landing .animate-glow-pulse,
  .landing .animate-marquee {
    animation: none;
  }
}
```

- [ ] **Step 6: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/lib/landing/ src/app/globals.css
git commit -m "feat(landing): add theme tokens and scroll-beat math"
```

---

### Task 3: Motion primitives

**Files:**
- Create: `src/components/landing/primitives/reveal.tsx`
- Create: `src/components/landing/primitives/parallax.tsx`
- Create: `src/components/landing/primitives/glow.tsx`
- Create: `src/components/landing/primitives/grid-bg.tsx`
- Create: `src/components/landing/primitives/use-loop.ts`

These are presentational/motion wrappers — no unit tests (covered by the Task 16 smoke test). Every primitive respects `prefers-reduced-motion`.

- [ ] **Step 1: Create `reveal.tsx`**

```tsx
"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Stagger offset in seconds. */
  delay?: number;
  className?: string;
}

/** Fades + rises children into view on scroll. Renders statically under reduced motion. */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.6, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Create `parallax.tsx`**

```tsx
"use client";

import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

interface ParallaxProps {
  children: ReactNode;
  /** Max vertical drift in px while the element crosses the viewport. Negative drifts up. */
  speed?: number;
  className?: string;
}

/** Scroll-linked vertical drift. Renders statically under reduced motion. */
export function Parallax({ children, speed = 40, className }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [-speed, speed]);

  if (reduced) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 3: Create `glow.tsx`**

```tsx
import { cn } from "@/lib/utils";

/**
 * Amber radial bloom. Position/size it with className (absolute positioning expected).
 * Pulse animation is defined in globals.css and disabled under reduced motion.
 */
export function Glow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-glow-pulse pointer-events-none absolute rounded-full blur-3xl",
        "bg-[radial-gradient(ellipse_at_center,var(--accent-amber-glow),transparent_70%)]",
        className
      )}
    />
  );
}
```

- [ ] **Step 4: Create `grid-bg.tsx`**

```tsx
import { cn } from "@/lib/utils";

/** Faint geometric grid backdrop, masked to fade toward the bottom. */
export function GridBg({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
        maskImage:
          "radial-gradient(ellipse 90% 70% at 50% 0%, black 40%, transparent 100%)",
      }}
    />
  );
}
```

- [ ] **Step 5: Create `use-loop.ts`**

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * Cycles 0..steps-1 on an interval while enabled. Drives looping demo mocks.
 * Pass enabled=false (e.g. from useInView) to pause off-screen and save CPU.
 */
export function useLoop(steps: number, intervalMs: number, enabled = true): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!enabled || steps <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % steps);
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, steps, intervalMs]);

  return index;
}
```

- [ ] **Step 6: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/primitives/
git commit -m "feat(landing): add motion primitives (Reveal, Parallax, Glow, GridBg, useLoop)"
```

---

### Task 4: Mock shells — AppWindow + FileGrid

**Files:**
- Create: `src/components/landing/mocks/app-window.tsx`
- Create: `src/components/landing/mocks/file-grid.tsx`

`AppWindow` is the central swap point: when real screenshots/videos exist, replace its children without touching section layout.

- [ ] **Step 1: Create `app-window.tsx`**

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface AppWindowProps {
  children: ReactNode;
  /** Mono path/title shown in the title bar, e.g. "my-bucket / images". */
  title?: string;
  /** Optional tab strip under the traffic lights. */
  tabs?: string[];
  activeTab?: number;
  /** Optional sidebar slot. */
  sidebar?: ReactNode;
  className?: string;
}

/**
 * Faux browser/app chrome wrapping every product mock on the landing page.
 * Swap point: replace children with a real screenshot or <video> later
 * without touching the surrounding section layout.
 */
export function AppWindow({
  children,
  title,
  tabs,
  activeTab = 0,
  sidebar,
  className,
}: AppWindowProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        {title && (
          <span className="ml-3 truncate font-mono text-xs text-white/40">{title}</span>
        )}
      </div>
      {tabs && tabs.length > 0 && (
        <div className="flex gap-1 border-b border-white/5 px-3 pt-2">
          {tabs.map((tab, i) => (
            <span
              key={tab}
              className={cn(
                "rounded-t-lg px-3 py-1.5 font-mono text-[11px] transition-colors",
                i === activeTab
                  ? "border border-b-0 border-white/10 bg-white/5 text-white/80"
                  : "text-white/35"
              )}
            >
              {tab}
            </span>
          ))}
        </div>
      )}
      <div className="flex">
        {sidebar && (
          <div className="hidden w-40 shrink-0 border-r border-white/5 p-3 sm:block">
            {sidebar}
          </div>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `file-grid.tsx`**

```tsx
import { Archive, FileText, Film, Folder, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type FileKind = "folder" | "image" | "doc" | "archive" | "video";

export interface FileItem {
  name: string;
  kind: FileKind;
  highlighted?: boolean;
}

const ICONS: Record<FileKind, typeof Folder> = {
  folder: Folder,
  image: ImageIcon,
  doc: FileText,
  archive: Archive,
  video: Film,
};

export function FileGrid({
  items,
  className,
}: {
  items: FileItem[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2 p-3 sm:grid-cols-4", className)}>
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.name}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg border border-transparent p-3",
              item.highlighted &&
                "border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10"
            )}
          >
            <Icon
              className={cn(
                "size-6",
                item.kind === "folder"
                  ? "text-[var(--accent-amber)]/80"
                  : "text-white/40"
              )}
            />
            <span className="max-w-full truncate font-mono text-[10px] text-white/50">
              {item.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/mocks/
git commit -m "feat(landing): add AppWindow and FileGrid mock shells"
```

---

### Task 5: Nav + Footer

**Files:**
- Create: `src/components/landing/nav.tsx`
- Create: `src/components/landing/footer.tsx`

Nav is auth-aware via Clerk. No hamburger menu (YAGNI): on mobile the two anchor links hide; logo + CTA remain.

- [ ] **Step 1: Create `nav.tsx`**

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";

const LINKS = [
  ["Features", "#features"],
  ["Pricing", "#pricing"],
] as const;

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-4">
      <nav className="mx-auto mt-4 flex max-w-5xl items-center justify-between rounded-2xl border border-white/10 bg-black/50 px-4 py-2.5 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="S3 Dock"
            width={24}
            height={24}
            className="rounded-md invert"
          />
          <span className="text-sm font-semibold tracking-tight text-white">
            S3 Dock
          </span>
        </Link>

        <div className="hidden items-center gap-6 text-sm text-white/60 md:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-white">
              {label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <SignedOut>
            <Link
              href="/sign-in"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-white/60 transition-colors hover:text-white sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-[var(--accent-amber)] px-3.5 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              Try free
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href="/buckets"
              className="rounded-lg bg-[var(--accent-amber)] px-3.5 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              Open app
            </Link>
          </SignedIn>
        </div>
      </nav>
    </header>
  );
}
```

Note: `/logo.png` is a dark logo — `invert` flips it white for the dark canvas; `rounded-md` softens the square background if the PNG is not transparent.

- [ ] **Step 2: Create `footer.tsx`**

```tsx
import Image from "next/image";
import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      ["Features", "#features"],
      ["Pricing", "#pricing"],
      ["Changelog", "#"],
    ],
  },
  {
    title: "Resources",
    links: [
      ["Docs", "#"],
      ["Status", "#"],
      ["Blog", "#"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "#"],
      ["Contact", "mailto:hello@s3dock.app"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["Privacy", "#"],
      ["Terms", "#"],
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-black/40 px-6 py-16">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-10 sm:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-xs font-medium uppercase tracking-widest text-white/40">
              {col.title}
            </p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  <a
                    href={href}
                    className="text-sm text-white/60 transition-colors hover:text-[var(--accent-amber)]"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-14 flex max-w-5xl flex-col items-center justify-between gap-4 border-t border-white/5 pt-8 sm:flex-row">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="S3 Dock"
            width={20}
            height={20}
            className="rounded invert"
          />
          <span className="text-sm font-semibold text-white">S3 Dock</span>
        </Link>
        <p className="text-xs text-white/40">
          © {new Date().getFullYear()} S3 Dock. All rights reserved.
        </p>
        <div className="flex gap-4 text-sm text-white/40">
          <a href="https://github.com" className="transition-colors hover:text-white">
            GitHub
          </a>
          <a href="https://x.com" className="transition-colors hover:text-white">
            X
          </a>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/nav.tsx src/components/landing/footer.tsx
git commit -m "feat(landing): add nav and footer"
```

---

### Task 6: Hero + VideoModal

**Files:**
- Create: `src/components/landing/video-modal.tsx`
- Create: `src/components/landing/hero.tsx`

- [ ] **Step 1: Create `video-modal.tsx`**

```tsx
"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface VideoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Full-screen demo player. Radix handles ESC-to-close and focus trapping.
 * If the video assets are missing (they are until the demo is produced),
 * the onError fallback shows a "coming soon" panel instead of a broken player.
 */
export function VideoModal({ open, onOpenChange }: VideoModalProps) {
  const [failed, setFailed] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,1100px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_80px_var(--accent-amber-glow)] focus:outline-none">
          <Dialog.Title className="sr-only">S3 Dock product demo</Dialog.Title>
          {failed ? (
            <div className="flex aspect-video items-center justify-center font-mono text-sm text-white/50">
              Demo video coming soon.
            </div>
          ) : (
            <video
              className="aspect-video w-full"
              poster="/demo/poster.png"
              controls
              autoPlay
              onError={() => setFailed(true)}
            >
              <source src="/demo/showcase.webm" type="video/webm" />
              <source src="/demo/showcase.mp4" type="video/mp4" />
            </video>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Create `hero.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Glow } from "./primitives/glow";
import { GridBg } from "./primitives/grid-bg";
import { AppWindow } from "./mocks/app-window";
import { FileGrid, type FileItem } from "./mocks/file-grid";
import { VideoModal } from "./video-modal";

const HEADLINE = ["S3,", "finally", "usable."];

const HERO_FILES: FileItem[] = [
  { name: "design-assets", kind: "folder" },
  { name: "backups", kind: "folder" },
  { name: "hero.png", kind: "image", highlighted: true },
  { name: "report-q2.pdf", kind: "doc" },
  { name: "archive.zip", kind: "archive" },
  { name: "launch.mp4", kind: "video" },
  { name: "notes.md", kind: "doc" },
  { name: "favicon.svg", kind: "image" },
];

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const tileY = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const tileScale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 pb-16 pt-28"
    >
      <GridBg />
      <Glow className="left-1/2 top-0 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/3" />

      <div className="relative z-10 flex max-w-3xl flex-col items-center text-center">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2 rounded-full border border-white/15 px-3.5 py-1.5 text-xs text-white/60"
        >
          <span className="size-1.5 rounded-full bg-[var(--accent-amber)] shadow-[0_0_8px_var(--accent-amber)]" />
          Now in beta
        </motion.div>

        <h1 className="mt-6 text-5xl font-semibold tracking-[-0.03em] text-white sm:text-6xl md:text-7xl">
          {HEADLINE.map((word, i) => (
            <motion.span
              key={word}
              className="inline-block"
              initial={reduced ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                delay: 0.15 + i * 0.12,
                ease: [0.21, 0.47, 0.32, 0.98],
              }}
            >
              {word}
              {i < HEADLINE.length - 1 ? " " : ""}
            </motion.span>
          ))}
        </h1>

        <motion.p
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-5 max-w-xl text-balance text-lg text-[var(--landing-muted)]"
        >
          A modern web UI for S3, R2, MinIO, and anything else that speaks the
          protocol. Browse, search, and move files like it&apos;s a drive.
        </motion.p>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.62 }}
          className="mt-8 flex items-center gap-3"
        >
          <button
            onClick={() => setVideoOpen(true)}
            className="flex items-center gap-2 rounded-full bg-[var(--accent-amber)] px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            <Play className="size-4" />
            Watch the demo
          </button>
          <Link
            href="/sign-up"
            className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm text-white/80 transition-colors hover:border-white/30 hover:text-white"
          >
            Try free
            <ArrowRight className="size-4" />
          </Link>
        </motion.div>
      </div>

      <motion.div
        initial={reduced ? false : { opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.75 }}
        style={reduced ? undefined : { y: tileY, scale: tileScale }}
        className="relative z-10 mt-14 w-full max-w-4xl"
      >
        <button
          onClick={() => setVideoOpen(true)}
          aria-label="Play the S3 Dock demo video"
          className="group relative block w-full cursor-pointer text-left"
        >
          <AppWindow
            title="s3dock.app — demo"
            className="shadow-[0_40px_120px_var(--accent-amber-glow)]"
          >
            <div className="relative">
              <FileGrid items={HERO_FILES} className="py-6 opacity-80" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/20">
                <span className="flex size-16 items-center justify-center rounded-full bg-white/95 text-black shadow-xl transition-transform group-hover:scale-110">
                  <Play className="ml-1 size-6" />
                </span>
              </div>
            </div>
          </AppWindow>
        </button>
      </motion.div>

      <VideoModal open={videoOpen} onOpenChange={setVideoOpen} />
    </section>
  );
}
```

Note: the video tile uses the `FileGrid` mock as its poster (no image asset needed). When the real `poster.png` exists, swap the `FileGrid` for an `<Image>` inside the same `AppWindow`.

- [ ] **Step 3: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/hero.tsx src/components/landing/video-modal.tsx
git commit -m "feat(landing): add video-led hero with demo modal"
```

---

### Task 7: Compose the page + route swap (first shippable state)

**Files:**
- Create: `src/components/landing/landing-page.tsx`
- Create: `src/app/(public)/page.tsx`
- Delete: `src/app/page.tsx`
- Modify: `src/proxy.ts`

After this task, `/` renders Nav + Hero + Footer for visitors; signed-in users still land in the app.

- [ ] **Step 1: Create `landing-page.tsx`**

```tsx
import { Nav } from "./nav";
import { Hero } from "./hero";
import { Footer } from "./footer";

/**
 * Landing page composition. Sections are appended here as they are built.
 * The `landing dark` wrapper forces dark mode for this page only and scopes
 * the landing CSS variables — it intentionally bypasses the OS-preference
 * script in the (public) layout, which /s/[slug] still uses.
 */
export function LandingPage() {
  return (
    <div className="landing dark min-h-screen bg-[var(--landing-bg)] text-white antialiased">
      <Nav />
      <main>
        <Hero />
      </main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(public)/page.tsx`**

```tsx
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

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

export default function Home() {
  return <LandingPage />;
}
```

- [ ] **Step 3: Delete the old root page**

```bash
rm src/app/page.tsx
```

(The old file only did `redirect("/buckets")` — that behavior moves to the proxy in the next step.)

- [ ] **Step 4: Update `src/proxy.ts`**

Replace the full file with:

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk(.*)",
  "/api/internal/(.*)",
  "/s(.*)",
]);

const clerkProxy = clerkMiddleware(async (auth, req) => {
  // Landing page: public for visitors, but signed-in users go straight to the app
  if (req.nextUrl.pathname === "/") {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL("/buckets", req.url));
    }
    return;
  }

  // Protect all routes except public ones
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export function proxy(request: NextRequest) {
  return clerkProxy(request, {} as never);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
```

- [ ] **Step 5: Verify build + manual check**

Run: `pnpm lint && pnpm build`
Expected: lint clean; build succeeds with `/` listed as a route under `(public)`.

Manual verification (run `pnpm dev`):
- Open `/` in a private window (signed out) → landing hero renders, dark canvas, amber CTAs.
- Open `/` while signed in → redirected to `/buckets`.
- `/s/<anything>` still resolves through its own layout (unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/landing-page.tsx "src/app/(public)/page.tsx" src/proxy.ts
git rm --cached src/app/page.tsx 2>/dev/null; git add -A src/app
git commit -m "feat(landing): serve landing page at / with signed-in redirect to app"
```

---

### Task 8: §1 Problem split (before/after)

**Files:**
- Create: `src/components/landing/problem-split.tsx`
- Modify: `src/components/landing/landing-page.tsx`

- [ ] **Step 1: Create `problem-split.tsx`**

```tsx
"use client";

import { motion } from "motion/react";
import { Parallax } from "./primitives/parallax";
import { Reveal } from "./primitives/reveal";
import { AppWindow } from "./mocks/app-window";
import { FileGrid, type FileItem } from "./mocks/file-grid";

const DOCK_FILES: FileItem[] = [
  { name: "assets", kind: "folder" },
  { name: "uploads", kind: "folder" },
  { name: "banner.png", kind: "image" },
  { name: "invoice.pdf", kind: "doc" },
  { name: "build.zip", kind: "archive" },
  { name: "promo.mp4", kind: "video" },
];

/** Desaturated, dense AWS-console caricature (left half of the split). */
function ConsoleMock() {
  return (
    <div className="rounded-xl border border-white/10 bg-[#141414] p-4 opacity-60 saturate-50">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-5 w-36 rounded bg-white/10" />
        <div className="h-5 w-20 rounded bg-white/10" />
        <div className="h-5 w-24 rounded bg-white/10" />
      </div>
      <div className="mb-3 flex gap-2">
        <div className="h-7 flex-1 rounded border border-white/10 bg-white/5" />
        <div className="h-7 w-20 rounded bg-white/10" />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="size-3 rounded-sm border border-white/20" />
            <div className="h-3 flex-1 rounded bg-white/10" />
            <div className="h-3 w-16 rounded bg-white/5" />
            <div className="h-3 w-12 rounded bg-white/5" />
            <div className="h-3 w-14 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProblemSplit() {
  return (
    <section className="relative overflow-hidden px-6 py-32">
      <Reveal className="mx-auto mb-16 max-w-3xl">
        <h2 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
          The AWS console wasn&apos;t built for humans.
        </h2>
        <p className="mt-4 text-lg text-[var(--landing-muted)]">We built one that was.</p>
      </Reveal>

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 md:grid-cols-2">
        {/* animated divider, desktop only */}
        <motion.div
          aria-hidden
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute left-1/2 top-0 hidden h-full w-px origin-top rotate-3 bg-gradient-to-b from-transparent via-[var(--accent-amber)]/50 to-transparent md:block"
        />

        <Parallax speed={30}>
          <span className="mb-3 inline-block rounded-full border border-white/15 px-3 py-1 font-mono text-xs text-white/40">
            S3 console
          </span>
          <ConsoleMock />
        </Parallax>

        <Parallax speed={-30}>
          <span className="mb-3 inline-block rounded-full border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 px-3 py-1 font-mono text-xs text-[var(--accent-amber)]">
            S3 Dock
          </span>
          <AppWindow title="my-bucket / assets">
            <div className="border-b border-white/5 px-4 py-2 font-mono text-xs text-white/40">
              Home <span className="text-white/20">/</span> my-bucket{" "}
              <span className="text-white/20">/</span>{" "}
              <span className="text-white/70">assets</span>
            </div>
            <FileGrid items={DOCK_FILES} />
          </AppWindow>
        </Parallax>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add to composition**

In `src/components/landing/landing-page.tsx`, add the import and render after `<Hero />`:

```tsx
import { ProblemSplit } from "./problem-split";
```
```tsx
      <main>
        <Hero />
        <ProblemSplit />
      </main>
```

- [ ] **Step 3: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/
git commit -m "feat(landing): add before/after problem split section"
```

---

### Task 9: Command palette mock + §3 Feature bento

**Files:**
- Create: `src/components/landing/mocks/command-palette-mock.tsx`
- Create: `src/components/landing/feature-bento.tsx`
- Modify: `src/components/landing/landing-page.tsx`

Bento layout (3-col desktop): row 1 = SplitView (tall, spans 2 rows) + Tabs (wide, 2 cols); row 2 = Search + Versions; row 3 = Multi-account (2 cols) + "everything else" chips tile. All loops gate on `useInView`.

- [ ] **Step 1: Create `command-palette-mock.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaletteScene {
  query: string;
  results: string[];
}

interface CommandPaletteMockProps {
  scenes: PaletteScene[];
  /** Pause typing when false (e.g. off-screen). */
  active?: boolean;
  className?: string;
}

/** ⌘K palette with a looping typewriter query and filtered results. */
export function CommandPaletteMock({
  scenes,
  active = true,
  className,
}: CommandPaletteMockProps) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [chars, setChars] = useState(0);
  const scene = scenes[sceneIndex];
  const done = chars >= scene.query.length;

  // type the query one character at a time
  useEffect(() => {
    if (!active || done) return;
    const id = setInterval(() => setChars((c) => c + 1), 70);
    return () => clearInterval(id);
  }, [active, done, sceneIndex]);

  // hold the finished query, then advance to the next scene
  useEffect(() => {
    if (!active || !done) return;
    const id = setTimeout(() => {
      setSceneIndex((i) => (i + 1) % scenes.length);
      setChars(0);
    }, 1800);
    return () => clearTimeout(id);
  }, [active, done, scenes.length]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-white/10 bg-[#101010] shadow-2xl",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <Search className="size-4 shrink-0 text-white/30" />
        <span className="font-mono text-sm text-white/80">
          {scene.query.slice(0, chars)}
          <span className="animate-pulse text-[var(--accent-amber)]">▏</span>
        </span>
        <kbd className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/40">
          ⌘K
        </kbd>
      </div>
      <div className="p-2">
        {scene.results.map((result, i) => (
          <div
            key={result}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs text-white/50 transition-opacity duration-300",
              !done && "opacity-0",
              done && i === 0 && "bg-[var(--accent-amber)]/10 text-white/80"
            )}
          >
            <FileText className="size-3.5 shrink-0 text-white/30" />
            {result}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `feature-bento.tsx`**

```tsx
"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { ChevronDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./primitives/reveal";
import { useLoop } from "./primitives/use-loop";
import { FileGrid, type FileItem } from "./mocks/file-grid";
import { CommandPaletteMock } from "./mocks/command-palette-mock";

const TAB_BUCKETS: Record<string, FileItem[]> = {
  "prod-assets": [
    { name: "logo.svg", kind: "image" },
    { name: "fonts", kind: "folder" },
    { name: "og.png", kind: "image" },
  ],
  "user-uploads": [
    { name: "avatars", kind: "folder" },
    { name: "exports", kind: "folder" },
    { name: "tmp.zip", kind: "archive" },
  ],
  backups: [
    { name: "db-monday.gz", kind: "archive" },
    { name: "db-tuesday.gz", kind: "archive" },
    { name: "snapshots", kind: "folder" },
  ],
};

function Tile({
  title,
  caption,
  className,
  children,
}: {
  title: string;
  caption: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-all duration-300",
        "hover:scale-[1.01] hover:border-[var(--accent-amber)]/30 hover:shadow-[0_0_40px_var(--accent-amber-glow)]",
        className
      )}
    >
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mb-4 mt-1 text-sm text-[var(--landing-muted)]">{caption}</p>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function SplitViewTile({ active }: { active: boolean }) {
  return (
    <Tile
      title="Split view"
      caption="Two buckets side by side. Drag files straight across."
      className="md:row-span-2"
    >
      <div className="space-y-3">
        <div className="relative rounded-lg border border-white/10 bg-[#0d0d0d] p-2">
          <p className="mb-1 font-mono text-[10px] text-white/40">prod / images</p>
          <FileGrid
            items={[
              { name: "a.png", kind: "image" },
              { name: "b.png", kind: "image" },
              { name: "c.png", kind: "image" },
            ]}
            className="grid-cols-3 gap-1 p-1"
          />
          <motion.div
            animate={
              active
                ? { x: [0, 0, 0], y: [0, 90, 90], opacity: [1, 1, 0] }
                : { x: 0, y: 0, opacity: 1 }
            }
            transition={
              active ? { duration: 4, repeat: Infinity, times: [0.2, 0.6, 0.8] } : undefined
            }
            className="absolute left-3 top-8 z-10 rounded-md border border-[var(--accent-amber)]/50 bg-[var(--accent-amber)]/20 px-2 py-1 font-mono text-[10px] text-[var(--accent-amber)]"
          >
            hero-final.png
          </motion.div>
        </div>
        <div className="rounded-lg border border-dashed border-[var(--accent-amber)]/40 bg-[#0d0d0d] p-2">
          <p className="mb-1 font-mono text-[10px] text-white/40">staging / images</p>
          <FileGrid
            items={[
              { name: "old.png", kind: "image" },
              { name: "draft.png", kind: "image" },
            ]}
            className="grid-cols-3 gap-1 p-1"
          />
        </div>
      </div>
    </Tile>
  );
}

function TabsTile({ active }: { active: boolean }) {
  const names = Object.keys(TAB_BUCKETS);
  const tab = useLoop(names.length, 2500, active);
  return (
    <Tile
      title="Tabs"
      caption="Every bucket one click away — like browser tabs, for storage."
      className="md:col-span-2"
    >
      <div className="rounded-lg border border-white/10 bg-[#0d0d0d]">
        <div className="flex gap-1 border-b border-white/5 px-2 pt-2">
          {names.map((name, i) => (
            <span
              key={name}
              className={cn(
                "rounded-t-md px-3 py-1.5 font-mono text-[11px] transition-colors duration-300",
                i === tab ? "bg-white/10 text-white/90" : "text-white/35"
              )}
            >
              {name}
            </span>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <FileGrid items={TAB_BUCKETS[names[tab]]} className="grid-cols-3 p-2" />
          </motion.div>
        </AnimatePresence>
      </div>
    </Tile>
  );
}

function SearchTile({ active }: { active: boolean }) {
  return (
    <Tile title="Indexed search" caption="Search file names across every connected bucket, instantly.">
      <CommandPaletteMock
        active={active}
        scenes={[
          { query: "invoice.pdf", results: ["billing/2026/invoice.pdf", "archive/invoice.pdf"] },
          { query: "hero image", results: ["assets/img/hero.png", "marketing/hero-v2.png"] },
          { query: "*.zip", results: ["builds/v1.4.0.zip", "exports/data.zip"] },
        ]}
      />
    </Tile>
  );
}

function VersionsTile({ active }: { active: boolean }) {
  const versions = ["Today 14:32", "Yesterday 09:10", "Jun 2, 18:45"];
  const highlight = useLoop(versions.length, 1800, active);
  return (
    <Tile title="Versions" caption="Every revision of every file, one click to restore.">
      <div className="space-y-1.5 rounded-lg border border-white/10 bg-[#0d0d0d] p-2">
        {versions.map((v, i) => (
          <div
            key={v}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-300",
              i === highlight
                ? "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]"
                : "text-white/40"
            )}
          >
            <Clock className="size-3" />
            report.docx — {v}
          </div>
        ))}
      </div>
    </Tile>
  );
}

function MultiAccountTile({ active }: { active: boolean }) {
  const open = useLoop(2, 2200, active) === 1;
  const connections = [
    ["AWS S3", "us-east-1"],
    ["Cloudflare R2", "auto"],
    ["MinIO", "homelab"],
  ];
  return (
    <Tile
      title="Every account, one place"
      caption="Switch between AWS, R2, MinIO and more without re-logging in."
      className="md:col-span-2"
    >
      <div className="rounded-lg border border-white/10 bg-[#0d0d0d] p-2">
        <div className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2 font-mono text-xs text-white/70">
          AWS S3 · us-east-1
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")}
          />
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              {connections.map(([name, region]) => (
                <div
                  key={name}
                  className="flex justify-between px-3 py-1.5 font-mono text-[11px] text-white/40"
                >
                  {name} <span className="text-white/25">{region}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Tile>
  );
}

function MoreTile() {
  const extras = ["Previews", "File notes", "Activity feed", "Health checks", "Bookmarks", "Share links"];
  return (
    <Tile title="And the rest" caption="Small things that add up.">
      <div className="flex flex-wrap gap-1.5">
        {extras.map((label) => (
          <span
            key={label}
            className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-white/50"
          >
            {label}
          </span>
        ))}
      </div>
    </Tile>
  );
}

export function FeatureBento() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });

  return (
    <section id="features" className="px-6 py-32">
      <Reveal className="mx-auto mb-16 max-w-3xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
          Power tools, zero terminal.
        </h2>
        <p className="mt-4 text-lg text-[var(--landing-muted)]">
          Everything the console makes hard, one click away.
        </p>
      </Reveal>

      <div ref={ref} className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-3">
        <SplitViewTile active={inView} />
        <TabsTile active={inView} />
        <SearchTile active={inView} />
        <VersionsTile active={inView} />
        <MultiAccountTile active={inView} />
        <MoreTile />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add to composition**

In `landing-page.tsx`:

```tsx
import { FeatureBento } from "./feature-bento";
```
```tsx
      <main>
        <Hero />
        <ProblemSplit />
        <FeatureBento />
      </main>
```

- [ ] **Step 4: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/
git commit -m "feat(landing): add feature bento with animated demo tiles"
```

---

### Task 10: §5 Compatibility (providers + connect demo)

**Files:**
- Create: `src/components/landing/compatibility.tsx`
- Modify: `src/components/landing/landing-page.tsx`

Provider "logos" are text wordmark chips (no third-party brand SVGs to license or maintain). Marquee uses the CSS keyframes from Task 2 with a duplicated list for a seamless loop.

- [ ] **Step 1: Create `compatibility.tsx`**

```tsx
"use client";

import { useRef } from "react";
import { useInView } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./primitives/reveal";
import { useLoop } from "./primitives/use-loop";

const PROVIDERS = [
  "AWS S3",
  "Cloudflare R2",
  "MinIO",
  "Backblaze B2",
  "DigitalOcean Spaces",
  "Wasabi",
  "Ceph",
];

/** Auto-filling 3-field connection form: empty → filled → connected. */
function ConnectDemo({ active }: { active: boolean }) {
  const step = useLoop(3, 1600, active);

  const fields = [
    ["Endpoint", "https://s3.us-east-1.amazonaws.com"],
    ["Access key", "AKIA••••••••EXAMPLE"],
    ["Secret key", "••••••••••••••••"],
  ] as const;

  return (
    <div className="mx-auto mt-12 w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <p className="mb-4 font-mono text-xs text-white/40">New connection</p>
      <div className="space-y-3">
        {fields.map(([label, value]) => (
          <div key={label}>
            <p className="mb-1 text-[11px] text-white/40">{label}</p>
            <div className="flex h-9 items-center rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-xs text-white/70">
              {step >= 1 ? value : ""}
            </div>
          </div>
        ))}
      </div>
      <div
        className={cn(
          "mt-4 flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors duration-300",
          step === 2
            ? "bg-green-500/15 text-green-400"
            : "bg-[var(--accent-amber)] text-black"
        )}
      >
        {step === 2 ? (
          <>
            <Check className="size-4" /> Connected
          </>
        ) : (
          "Connect"
        )}
      </div>
    </div>
  );
}

export function Compatibility() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });

  return (
    <section className="overflow-hidden px-6 py-32">
      <Reveal className="mx-auto mb-12 max-w-3xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
          One client. Every S3.
        </h2>
        <p className="mt-4 text-lg text-[var(--landing-muted)]">
          If it speaks the S3 protocol, S3 Dock connects to it. Setup takes about
          thirty seconds.
        </p>
      </Reveal>

      <div className="marquee-group relative mx-auto max-w-5xl" ref={ref}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[var(--landing-bg)] to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[var(--landing-bg)] to-transparent"
        />
        <div className="animate-marquee flex w-max gap-3">
          {[...PROVIDERS, ...PROVIDERS].map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 font-mono text-sm text-white/60"
            >
              {name}
            </span>
          ))}
          <span className="rounded-full border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 px-5 py-2.5 font-mono text-sm text-[var(--accent-amber)]">
            + any S3-compatible endpoint
          </span>
        </div>
      </div>

      <Reveal delay={0.15}>
        <ConnectDemo active={inView} />
      </Reveal>
    </section>
  );
}
```

- [ ] **Step 2: Add to composition**

In `landing-page.tsx`:

```tsx
import { Compatibility } from "./compatibility";
```
```tsx
      <main>
        <Hero />
        <ProblemSplit />
        <FeatureBento />
        <Compatibility />
      </main>
```

- [ ] **Step 3: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/
git commit -m "feat(landing): add provider compatibility marquee and connect demo"
```

---

### Task 11: §6 Teams

**Files:**
- Create: `src/components/landing/teams.tsx`
- Modify: `src/components/landing/landing-page.tsx`

- [ ] **Step 1: Create `teams.tsx`**

```tsx
"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { Copy, Link2, Shield, Users } from "lucide-react";
import { Reveal } from "./primitives/reveal";
import { useLoop } from "./primitives/use-loop";

function ShareLinkCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
        <Link2 className="size-4 text-[var(--accent-amber)]" /> Share link
      </div>
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-3 py-2">
        <span className="truncate font-mono text-xs text-white/60">
          s3dock.app/s/q2-report-x7f2
        </span>
        <Copy className="size-3.5 shrink-0 text-white/40" />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-white/50">
        <span>Expires in 7 days</span>
        <span className="rounded-full bg-[var(--accent-amber)]/15 px-2 py-0.5 font-mono text-[10px] text-[var(--accent-amber)]">
          password protected
        </span>
      </div>
    </div>
  );
}

function TeamMembersCard() {
  const members = [
    ["AM", "Ana M.", "Owner"],
    ["JK", "Jonas K.", "Editor"],
    ["RD", "Rita D.", "Viewer"],
  ] as const;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
        <Users className="size-4 text-[var(--accent-amber)]" /> Team
      </div>
      <div className="space-y-2.5">
        {members.map(([initials, name, role]) => (
          <div key={name} className="flex items-center gap-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-white/10 font-mono text-[10px] text-white/70">
              {initials}
            </span>
            <span className="flex-1 text-sm text-white/70">{name}</span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/40">
              {role}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermissionsCard() {
  const rules = [
    ["prod-assets", "read-only"],
    ["user-uploads", "read & write"],
    ["backups", "no access"],
  ] as const;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
        <Shield className="size-4 text-[var(--accent-amber)]" /> Permissions
      </div>
      <div className="space-y-2.5">
        {rules.map(([bucket, access]) => (
          <div key={bucket} className="flex items-center justify-between">
            <span className="font-mono text-xs text-white/60">{bucket}</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/50">
              {access}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CARDS = [
  { id: "share", node: <ShareLinkCard /> },
  { id: "team", node: <TeamMembersCard /> },
  { id: "permissions", node: <PermissionsCard /> },
];

export function Teams() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const active = useLoop(CARDS.length, 3500, inView);

  return (
    <section className="px-6 py-32">
      <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-14 md:grid-cols-2">
        <Reveal>
          <h2 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
            Storage your whole team can actually use.
          </h2>
          <p className="mt-5 text-lg text-[var(--landing-muted)]">
            Share links, granular permissions, and team workspaces — without
            handing out AWS keys.
          </p>
        </Reveal>

        <div ref={ref} className="relative mx-auto w-full max-w-sm" style={{ perspective: 1000 }}>
          {/* static ghost cards behind the active one for the stacked look */}
          <div
            aria-hidden
            className="absolute inset-x-4 -top-3 h-full rounded-2xl border border-white/5 bg-white/[0.02]"
          />
          <div
            aria-hidden
            className="absolute inset-x-2 -top-1.5 h-full rounded-2xl border border-white/5 bg-white/[0.02]"
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={CARDS[active].id}
              initial={{ opacity: 0, y: 16, rotateX: -8 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.45 }}
              className="relative"
            >
              {CARDS[active].node}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add to composition**

In `landing-page.tsx`:

```tsx
import { Teams } from "./teams";
```
```tsx
        <Compatibility />
        <Teams />
```

- [ ] **Step 3: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/
git commit -m "feat(landing): add teams section with rotating capability cards"
```

---

### Task 12: §2 Metaphor reveal (sticky scroll-jack)

**Files:**
- Create: `src/components/landing/metaphor-reveal.tsx`
- Modify: `src/components/landing/landing-page.tsx`

Uses `getBeat` from Task 2. Section is `250svh` tall with a sticky `100svh` stage; scroll progress maps to 3 beats. Under reduced motion it renders the three beats as static stacked blocks.

- [ ] **Step 1: Create `metaphor-reveal.tsx`**

```tsx
"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";
import { cn } from "@/lib/utils";
import { getBeat } from "@/lib/landing/scroll-beats";
import { AppWindow } from "./mocks/app-window";
import { FileGrid, type FileItem } from "./mocks/file-grid";
import { CommandPaletteMock } from "./mocks/command-palette-mock";

const BROWSE_FILES: FileItem[] = [
  { name: "campaigns", kind: "folder" },
  { name: "logos", kind: "folder" },
  { name: "team-photo.jpg", kind: "image" },
  { name: "brand.pdf", kind: "doc" },
  { name: "icons.zip", kind: "archive" },
  { name: "promo.mp4", kind: "video" },
  { name: "summary.md", kind: "doc" },
  { name: "banner.png", kind: "image" },
];

function BrowseScene() {
  return (
    <div>
      <div className="border-b border-white/5 px-4 py-2 font-mono text-xs text-white/40">
        Home <span className="text-white/20">/</span> marketing{" "}
        <span className="text-white/20">/</span>{" "}
        <span className="text-white/70">assets</span>
      </div>
      <FileGrid items={BROWSE_FILES} />
    </div>
  );
}

function DragScene() {
  return (
    <div className="relative">
      <div className="border-b border-white/5 px-4 py-2 font-mono text-xs text-white/40">
        Home <span className="text-white/20">/</span>{" "}
        <span className="text-white/70">uploads</span>
      </div>
      <FileGrid
        items={[
          { name: "uploads", kind: "folder" },
          { name: "site.zip", kind: "archive", highlighted: true },
          { name: "v2.zip", kind: "archive" },
          { name: "readme.md", kind: "doc" },
        ]}
      />
      <motion.div
        animate={{ x: [0, 110, 110], y: [0, 40, 40], opacity: [1, 1, 0] }}
        transition={{ duration: 3, repeat: Infinity, times: [0.25, 0.7, 0.95] }}
        className="absolute left-8 top-16 z-10 rounded-md border border-[var(--accent-amber)]/50 bg-[var(--accent-amber)]/20 px-2 py-1 font-mono text-[10px] text-[var(--accent-amber)]"
      >
        deploy.tar.gz
      </motion.div>
      <div className="absolute bottom-3 right-3 rounded-lg border border-white/10 bg-black/80 px-3 py-2 font-mono text-[11px] text-white/70 shadow-xl">
        Uploading 3 files… <span className="text-green-400">✓</span>
      </div>
    </div>
  );
}

function SearchScene() {
  return (
    <div className="flex items-center justify-center p-6">
      <CommandPaletteMock
        className="w-full max-w-md"
        scenes={[
          {
            query: "photos from launch",
            results: [
              "marketing/launch/team-photo.jpg",
              "marketing/launch/stage.png",
              "archive/launch-2025/crowd.jpg",
            ],
          },
        ]}
      />
    </div>
  );
}

interface Beat {
  title: string;
  body: string;
  scene: ReactNode;
}

const BEATS: Beat[] = [
  {
    title: "Folders, not prefixes.",
    body: "Navigate buckets the way you navigate your laptop — breadcrumbs, folders, and a grid of files. No key-prefix mental gymnastics.",
    scene: <BrowseScene />,
  },
  {
    title: "Drag, don't aws s3 cp.",
    body: "Upload, move, and reorganize with your mouse. Progress lives in a toast, not a terminal scrollback.",
    scene: <DragScene />,
  },
  {
    title: "Search like you mean it.",
    body: "Hit ⌘K and find any file across every bucket you've connected. Indexed, instant, everywhere.",
    scene: <SearchScene />,
  },
];

/** Static fallback for reduced motion: all beats visible, no pinning. */
function StaticBeats() {
  return (
    <section className="px-6 py-32">
      <div className="mx-auto max-w-6xl space-y-20">
        {BEATS.map((beat) => (
          <div
            key={beat.title}
            className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.4fr_1fr]"
          >
            <AppWindow title="s3dock.app">{beat.scene}</AppWindow>
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-white">
                {beat.title}
              </h3>
              <p className="mt-3 text-[var(--landing-muted)]">{beat.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MetaphorReveal() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState(0);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    setBeat(getBeat(value, BEATS.length).index);
  });

  if (reduced) {
    return <StaticBeats />;
  }

  return (
    <section ref={ref} className="relative h-[250svh]">
      <div className="sticky top-0 flex h-svh items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-[1.4fr_1fr]">
          <AppWindow title="s3dock.app">
            <AnimatePresence mode="wait">
              <motion.div
                key={beat}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35 }}
              >
                {BEATS[beat].scene}
              </motion.div>
            </AnimatePresence>
          </AppWindow>

          <div className="hidden space-y-12 lg:block">
            {BEATS.map((b, i) => (
              <div
                key={b.title}
                className={cn(
                  "transition-opacity duration-300",
                  i === beat ? "opacity-100" : "opacity-30"
                )}
              >
                <h3 className="text-2xl font-semibold tracking-tight text-white">
                  {b.title}
                </h3>
                <p className="mt-3 text-[var(--landing-muted)]">{b.body}</p>
              </div>
            ))}
          </div>

          {/* mobile: show only the active beat's text below the window */}
          <div className="lg:hidden">
            <h3 className="text-2xl font-semibold tracking-tight text-white">
              {BEATS[beat].title}
            </h3>
            <p className="mt-3 text-[var(--landing-muted)]">{BEATS[beat].body}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add to composition (between ProblemSplit and FeatureBento, per spec order)**

In `landing-page.tsx`:

```tsx
import { MetaphorReveal } from "./metaphor-reveal";
```
```tsx
      <main>
        <Hero />
        <ProblemSplit />
        <MetaphorReveal />
        <FeatureBento />
        <Compatibility />
        <Teams />
      </main>
```

- [ ] **Step 3: Lint and manual scroll check**

Run: `pnpm lint`
Expected: no errors.

Manual (pnpm dev): scrolling through the section pins the stage; beats 1→2→3 swap scenes and highlight the matching text; scrolling back reverses. With OS reduced-motion enabled, the section renders as three static rows.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/
git commit -m "feat(landing): add sticky scroll-jacked drive metaphor reveal"
```

---

### Task 13: §4 Transfer arc

**Files:**
- Create: `src/components/landing/transfer-arc.tsx`
- Modify: `src/components/landing/landing-page.tsx`

The packet position is computed from the SVG path via `getPointAtLength` (guarded — jsdom doesn't implement it). The trail draws via motion's `pathLength`. Scroll-scrubbed: forward sends the file, backward rewinds.

- [ ] **Step 1: Create `transfer-arc.tsx`**

```tsx
"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { Reveal } from "./primitives/reveal";
import { AppWindow } from "./mocks/app-window";
import { FileGrid } from "./mocks/file-grid";

const ARC_D = "M 150 70 C 420 40, 420 350, 650 320";

export function TransferArc() {
  const ref = useRef<HTMLElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  // map the middle 60% of the section's viewport transit onto the arc
  const arcProgress = useTransform(scrollYProgress, [0.25, 0.75], [0, 1], {
    clamp: true,
  });

  const cx = useMotionValue(150);
  const cy = useMotionValue(70);

  useMotionValueEvent(arcProgress, "change", (value) => {
    const path = pathRef.current;
    // getPointAtLength is unavailable in jsdom and very old browsers
    if (!path || typeof path.getTotalLength !== "function") return;
    const point = path.getPointAtLength(value * path.getTotalLength());
    cx.set(point.x);
    cy.set(point.y);
  });

  return (
    <section ref={ref} className="relative overflow-hidden px-6 py-32">
      <Reveal className="mx-auto mb-16 max-w-3xl">
        <h2 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
          Move files between any two buckets.
        </h2>
        <p className="mt-4 text-lg text-[var(--landing-muted)]">
          Across accounts, across providers, across regions. Drag in one window,
          drop in another.
        </p>
      </Reveal>

      <div className="relative mx-auto max-w-5xl">
        {/* the arc, desktop only */}
        <svg
          viewBox="0 0 800 420"
          fill="none"
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 hidden h-full w-full md:block"
        >
          <defs>
            <linearGradient id="arc-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--accent-amber)" stopOpacity="0.1" />
              <stop offset="100%" stopColor="var(--accent-amber)" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path d={ARC_D} stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
          <motion.path
            ref={pathRef}
            d={ARC_D}
            stroke="url(#arc-gradient)"
            strokeWidth="2"
            style={reduced ? undefined : { pathLength: arcProgress }}
          />
          {!reduced && (
            <motion.circle
              cx={cx}
              cy={cy}
              r="6"
              fill="var(--accent-amber)"
              style={{ filter: "drop-shadow(0 0 8px var(--accent-amber))" }}
            />
          )}
        </svg>

        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-24">
          <AppWindow title="prod · AWS us-east-1" className="md:mb-32">
            <FileGrid
              items={[
                { name: "release-v2.zip", kind: "archive", highlighted: true },
                { name: "assets", kind: "folder" },
                { name: "config.json", kind: "doc" },
              ]}
              className="grid-cols-3"
            />
          </AppWindow>
          <AppWindow title="backup · Cloudflare R2" className="md:mt-32">
            <FileGrid
              items={[
                { name: "archive-2025", kind: "folder" },
                { name: "archive-2026", kind: "folder" },
                { name: "release-v1.zip", kind: "archive" },
              ]}
              className="grid-cols-3"
            />
          </AppWindow>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add to composition (after FeatureBento, per spec order)**

In `landing-page.tsx`:

```tsx
import { TransferArc } from "./transfer-arc";
```
```tsx
        <FeatureBento />
        <TransferArc />
        <Compatibility />
```

- [ ] **Step 3: Lint and manual check**

Run: `pnpm lint`
Expected: no errors.

Manual (pnpm dev): on desktop, scrolling the section draws the amber arc and moves the glowing packet from the "prod" window toward "backup"; scrolling up rewinds it. On mobile the windows stack and the arc hides.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/
git commit -m "feat(landing): add scroll-scrubbed cross-bucket transfer arc"
```

---

### Task 14: §7 Pricing (shared plan data + FAQ + modal refactor)

**Files:**
- Create: `src/lib/subscriptions/plan-display.ts`
- Create: `src/components/landing/pricing.tsx`
- Modify: `src/components/billing/plans-modal.tsx`
- Modify: `src/components/landing/landing-page.tsx`

Plan data is extracted from `plans-modal.tsx` (the existing source of truth for display copy) into a shared constant so the landing page and the in-app modal can never drift.

- [ ] **Step 1: Create `plan-display.ts`**

```ts
/**
 * Display copy for subscription plans, shared by the landing page pricing
 * section and the in-app upgrade modal. Limits themselves are enforced by
 * tiers.ts — this file is presentation only.
 */
export interface PlanDisplay {
  id: "free" | "pro" | "enterprise";
  name: string;
  price: string;
  period: string;
  features: readonly string[];
  /** Features intentionally absent from this plan (shown struck-through). */
  missing?: readonly string[];
  /** The recommended plan gets highlighted treatment. */
  highlighted?: boolean;
}

export const PLAN_DISPLAYS: readonly PlanDisplay[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    features: [
      "2 connections",
      "50 MB file uploads",
      "1,000 operations/month",
      "File notes",
      "30-day activity history",
    ],
    missing: ["Share links", "Teams"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$4",
    period: "per month",
    highlighted: true,
    features: [
      "10 connections",
      "Unlimited file uploads",
      "50,000 operations/month",
      "Share links (password, expiry, analytics)",
      "1 team · 5 members",
      "90-day activity history",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "",
    features: [
      "Unlimited connections",
      "Unlimited uploads",
      "All PRO features",
      "Unlimited teams",
      "Unlimited activity history",
      "Priority support + SLA",
    ],
  },
];
```

- [ ] **Step 2: Refactor `plans-modal.tsx` to consume the shared data**

In `src/components/billing/plans-modal.tsx`:

1. Delete the local `PRO_FEATURES`, `FREE_FEATURES`, and `FREE_MISSING` constants (lines 16–33).
2. Add the import:

```tsx
import { PLAN_DISPLAYS } from "@/lib/subscriptions/plan-display";
```

3. Above the component's `return`, resolve the plans:

```tsx
  const freePlan = PLAN_DISPLAYS.find((p) => p.id === "free")!;
  const proPlan = PLAN_DISPLAYS.find((p) => p.id === "pro")!;
  const enterprisePlan = PLAN_DISPLAYS.find((p) => p.id === "enterprise")!;
```

4. Replace usages inside the JSX:
   - `FREE_FEATURES.map(...)` → `freePlan.features.map(...)`
   - `FREE_MISSING.map(...)` → `(freePlan.missing ?? []).map(...)`
   - `PRO_FEATURES.map(...)` → `proPlan.features.map(...)`
   - The hardcoded `$0` → `{freePlan.price}`, `$4` → `{proPlan.price}`
   - The Enterprise card's inline feature array → `enterprisePlan.features.map(...)` (same `<div>` body as before)
   - `Custom` price → `{enterprisePlan.price}`

Everything else in the modal (buttons, handlers, layout, badges) stays exactly as is.

- [ ] **Step 3: Create `pricing.tsx`**

```tsx
import Link from "next/link";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAN_DISPLAYS } from "@/lib/subscriptions/plan-display";
import { Reveal } from "./primitives/reveal";

const FAQS = [
  {
    q: "Do you store my files?",
    a: "No. Your files stay in your buckets — S3 Dock talks directly to your S3 endpoint. We store connection metadata and your credentials, encrypted at rest.",
  },
  {
    q: "Which providers work?",
    a: "Anything that speaks the S3 protocol: AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi, Ceph, and more.",
  },
  {
    q: "Is my data secure?",
    a: "Credentials are encrypted at rest, all traffic runs over HTTPS, and secret keys are never returned by our API after you save them.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Downgrade or cancel from the billing page whenever you like — your connections and settings stay put.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes — two connections and 1,000 operations a month, free forever. No credit card required.",
  },
];

function PlanCta({ planId }: { planId: string }) {
  if (planId === "enterprise") {
    return (
      <a
        href="mailto:hello@s3dock.app"
        className="mt-6 block rounded-lg border border-white/15 py-2 text-center text-sm text-white/80 transition-colors hover:border-white/30"
      >
        Contact us
      </a>
    );
  }
  return (
    <Link
      href="/sign-up"
      className={cn(
        "mt-6 block rounded-lg py-2 text-center text-sm font-semibold transition-opacity hover:opacity-90",
        planId === "pro"
          ? "bg-[var(--accent-amber)] text-black"
          : "border border-white/15 text-white/80"
      )}
    >
      Get started
    </Link>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="px-6 py-32">
      <Reveal className="mx-auto mb-16 max-w-3xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
          Simple pricing. No surprises.
        </h2>
        <p className="mt-4 text-lg text-[var(--landing-muted)]">
          Start free. Upgrade when your storage outgrows you.
        </p>
      </Reveal>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3">
        {PLAN_DISPLAYS.map((plan, i) => (
          <Reveal key={plan.id} delay={i * 0.1}>
            <div
              className={cn(
                "relative h-full rounded-2xl border p-6",
                plan.highlighted
                  ? "border-[var(--accent-amber)]/50 bg-[var(--accent-amber)]/5 shadow-[0_0_50px_var(--accent-amber-glow)] md:-translate-y-2"
                  : "border-white/10 bg-white/[0.02]"
              )}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--accent-amber)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
                  Most popular
                </span>
              )}
              <p
                className={cn(
                  "text-xs font-medium uppercase tracking-widest",
                  plan.highlighted ? "text-[var(--accent-amber)]" : "text-white/40"
                )}
              >
                {plan.name}
              </p>
              <p className="mt-2 text-3xl font-bold text-white">{plan.price}</p>
              <p className="text-xs text-white/40">{plan.period || " "}</p>
              <div className="mt-5 space-y-2 border-t border-white/10 pt-5">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2 text-sm text-white/70">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-amber)]" />
                    {feature}
                  </div>
                ))}
                {(plan.missing ?? []).map((feature) => (
                  <div key={feature} className="flex items-start gap-2 text-sm text-white/30">
                    <X className="mt-0.5 size-3.5 shrink-0" />
                    {feature}
                  </div>
                ))}
              </div>
              <PlanCta planId={plan.id} />
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mx-auto mt-24 max-w-2xl">
        <Reveal>
          <h3 className="mb-6 text-center text-2xl font-semibold text-white">
            Questions, answered.
          </h3>
        </Reveal>
        <div className="space-y-2">
          {FAQS.map((faq) => (
            <Reveal key={faq.q}>
              <details className="group rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-white/90 [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <span className="text-white/40 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--landing-muted)]">
                  {faq.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add to composition**

In `landing-page.tsx`:

```tsx
import { Pricing } from "./pricing";
```
```tsx
        <Teams />
        <Pricing />
```

- [ ] **Step 5: Verify tests, lint**

Run: `pnpm test && pnpm lint`
Expected: all tests pass (plans-modal has no tests, but `tiers.test.ts` must still pass); lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/subscriptions/plan-display.ts src/components/billing/plans-modal.tsx src/components/landing/
git commit -m "feat(landing): add pricing section with shared plan data and FAQ"
```

---

### Task 15: §8 Final CTA

**Files:**
- Create: `src/components/landing/final-cta.tsx`
- Modify: `src/components/landing/landing-page.tsx`

- [ ] **Step 1: Create `final-cta.tsx`**

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Glow } from "./primitives/glow";
import { Parallax } from "./primitives/parallax";
import { Reveal } from "./primitives/reveal";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden px-6 py-44">
      <Glow className="left-1/2 top-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2" />

      {/* faint cube logo drifting behind the copy */}
      <Parallax speed={60} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Image
          src="/logo.png"
          alt=""
          aria-hidden
          width={420}
          height={420}
          className="opacity-[0.04] invert"
        />
      </Parallax>

      <Reveal className="relative z-10 mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className="text-5xl font-semibold tracking-tight text-white md:text-6xl">
          Stop fighting the console.
        </h2>
        <p className="mt-5 text-lg text-[var(--landing-muted)]">
          Connect your first bucket in under a minute.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <Link
            href="/sign-up"
            className="flex items-center gap-2 rounded-full bg-[var(--accent-amber)] px-7 py-3 font-semibold text-black transition-opacity hover:opacity-90"
          >
            Get started free
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="#top"
            className="text-sm text-white/50 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            Watch the demo again
          </a>
        </div>
      </Reveal>
    </section>
  );
}
```

- [ ] **Step 2: Add to composition + anchor the hero**

In `landing-page.tsx`, add the import and final section, and give the wrapper the `#top` anchor used by "Watch the demo again":

```tsx
import { FinalCta } from "./final-cta";
```

```tsx
export function LandingPage() {
  return (
    <div id="top" className="landing dark min-h-screen bg-[var(--landing-bg)] text-white antialiased">
      <Nav />
      <main>
        <Hero />
        <ProblemSplit />
        <MetaphorReveal />
        <FeatureBento />
        <TransferArc />
        <Compatibility />
        <Teams />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 3: Lint and commit**

Run: `pnpm lint`
Expected: no errors.

```bash
git add src/components/landing/
git commit -m "feat(landing): add final CTA section"
```

---

### Task 16: Smoke test + full verification

**Files:**
- Test: `src/components/landing/landing-page.test.tsx`

- [ ] **Step 1: Write the smoke test**

Create `src/components/landing/landing-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LandingPage } from "./landing-page";

// Clerk components need a provider; on the landing page they only gate CTAs.
vi.mock("@clerk/nextjs", () => ({
  SignedIn: () => null,
  SignedOut: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
  // jsdom lacks these APIs that motion relies on
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  class MockObserver {
    root = null;
    rootMargin = "";
    thresholds = [];
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = () => [];
  }
  // @ts-expect-error test stub
  window.IntersectionObserver = MockObserver;
  // @ts-expect-error test stub
  window.ResizeObserver = MockObserver;
});

describe("LandingPage", () => {
  it("renders the hero headline", () => {
    render(<LandingPage />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("usable");
  });

  it("renders every landing section heading", () => {
    render(<LandingPage />);
    for (const heading of [
      "The AWS console wasn't built for humans.",
      "Power tools, zero terminal.",
      "Move files between any two buckets.",
      "One client. Every S3.",
      "Storage your whole team can actually use.",
      "Simple pricing. No surprises.",
      "Stop fighting the console.",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeDefined();
    }
  });

  it("renders the metaphor beats", () => {
    render(<LandingPage />);
    expect(screen.getAllByText("Folders, not prefixes.").length).toBeGreaterThan(0);
  });
});
```

Note: `render` may print React warnings about video/motion props in jsdom — warnings are acceptable, failures are not. If `getByRole("heading", ...)` fails because a heading renders twice (mobile + desktop variants in MetaphorReveal use h3, not duplicated h2s — only beats are duplicated, handled with `getAllByText`).

- [ ] **Step 2: Run the test**

Run: `pnpm test -- landing-page`
Expected: PASS, 3 tests. If a heading assertion fails, check the exact string (apostrophes are `'` typographic in JSX — the test must match the rendered text; `wasn't` in JSX `wasn&apos;t` renders as `wasn't`).

- [ ] **Step 3: Full verification suite**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all tests pass, lint clean, production build succeeds.

- [ ] **Step 4: Manual reduced-motion + responsive pass**

Run `pnpm dev` and verify:
- Normal scroll: hero staggers in, sections reveal, sticky metaphor section pins and releases, transfer arc scrubs, marquee drifts, bento tiles loop only while visible.
- OS reduced-motion ON (Windows: Settings → Accessibility → Visual effects → Animation effects off): no entrance motion, metaphor section renders statically, marquee and glow pulse stop.
- Mobile width (~390px): nav collapses to logo + CTA, bento stacks to one column, transfer arc hides its SVG, split-view/metaphor remain readable.
- Anchors: nav "Features" → bento, "Pricing" → pricing, footer links work.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/landing-page.test.tsx
git commit -m "test(landing): add landing page smoke test"
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** Hero (Task 6–7), §1 (8), §2 (12), §3 (9), §4 (13), §5 (10), §6 (11), §7 (14), §8 (15), footer/nav (5), theme/route/middleware (2, 7), testing (2, 16), reduced-motion (every motion component + Task 16 step 4). Pricing toggle intentionally omitted (no annual tier exists — spec made it conditional).
- **Deviation from spec, justified:** headline animates per-word, not per-letter (kerning artifacts in variable-width fonts); §3 bento has a sixth "And the rest" chips tile to balance the 3-column grid (spec said 5 tiles; the extra tile is static text, trim if unwanted).
- **Type consistency:** `FileItem`/`FileKind` defined once in `file-grid.tsx` and imported elsewhere; `PaletteScene` defined in `command-palette-mock.tsx`; `getBeat`/`BeatState` from `scroll-beats.ts`; `PlanDisplay`/`PLAN_DISPLAYS` from `plan-display.ts` consumed by both pricing surfaces.
- **No placeholders:** every component ships complete code; the only intentionally-deferred asset is the demo video file itself, which has a coded fallback.
