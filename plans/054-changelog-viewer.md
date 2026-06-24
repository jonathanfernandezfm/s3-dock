# Plan 054: Add changelog button to sidebar and display changelog from markdown files

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 04e4c30..HEAD -- src/components/shared/app-sidebar.tsx src/app/api/ src/components/changelog/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `04e4c30`, 2026-06-24

## Why this matters

Users and the development team have no in-app way to discover what changed between releases. Adding a changelog viewer inside the sidebar gives users a convenient entry point to see what's new without leaving the app, and gives the maintainer a clear convention for where to record future releases. The feature is fully self-contained — changelog content lives as versioned markdown files in the source tree, read at runtime by a lightweight API route, and rendered in a dialog using the existing Dialog primitive. No database changes and no new runtime infrastructure are required.

## Current state

### Sidebar bottom section (`src/components/shared/app-sidebar.tsx`, lines 513–540)

The bottom of the `<aside>` has a fixed section with Settings and Billing links:

```tsx
// lines 513–540
<div className="p-4 border-t space-y-1">
  <Link
    href="/app/settings"
    aria-current={isSettingsActive && !isBillingActive ? "page" : undefined}
    className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
      isSettingsActive && !isBillingActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
    )}
  >
    <Settings className="h-4 w-4" />
    Settings
  </Link>
  <Link
    href="/app/settings/billing"
    aria-current={isBillingActive ? "page" : undefined}
    className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
      isBillingActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
    )}
  >
    <CreditCard className="h-4 w-4" />
    Billing
  </Link>
</div>
```

The changelog button goes inside this `div`, after the Billing link, using the same `flex items-center gap-3 px-3 py-2` class shape but as a `<button>` (not a `<Link>`) since it opens a dialog.

### Sidebar existing imports (lines 1–52)

The sidebar imports icons from `lucide-react`:
```tsx
import {
  Database, Settings, Users, Plug, ChevronRight, ChevronDown,
  Briefcase, Plus, MoreHorizontal, Pencil, Trash2, Loader2,
  GripVertical, Link2, CreditCard,
} from "lucide-react";
```

Add `ScrollText` to this import. `ScrollText` is a built-in lucide-react icon — confirm with `grep -r "ScrollText" node_modules/lucide-react/dist` or trust the package (it exists in lucide-react ≥ 0.400).

### Sidebar existing dialog pattern (lines 543–597)

The sidebar mounts dialog components below the `</>` of `<aside>` and controls them with local `useState`:

```tsx
const [editingConnection, setEditingConnection] = useState<ConnectionResponse | null>(null);
const [deletingConnection, setDeletingConnection] = useState<ConnectionResponse | null>(null);
```

Add `const [changelogOpen, setChangelogOpen] = useState(false);` alongside these.

### Existing Dialog primitive (`src/components/ui/dialog.tsx`)

Available exports: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`. No Sheet component exists — the codebase uses Radix Dialog for all modal overlays.

### API route pattern

All API routes live under `src/app/api/`. Routes that return read-only data (no auth required for changelog content — it is not user-sensitive) use plain `NextResponse.json(...)` without a `withAuth` wrapper. Example of the simplest possible route: `src/app/api/internal/health/route.ts`.

### No existing markdown renderer

`package.json` does not include `react-markdown`, `remark-gfm`, `marked`, or any other MD renderer. Step 1 installs the two packages needed.

## Commands you will need

| Purpose    | Command                                        | Expected on success          |
|------------|------------------------------------------------|------------------------------|
| Install    | `pnpm install`                                 | exit 0                       |
| Typecheck  | `pnpm typecheck`                               | exit 0, no errors            |
| Lint       | `pnpm lint`                                    | exit 0                       |
| Tests      | `pnpm test`                                    | all pass                     |
| Dev server | `pnpm dev`                                     | started on port 3000         |

## Scope

**In scope** (only these files should be modified or created):
- `src/content/changelog/` ← **new directory**; create it
- `src/content/changelog/2026-06-24-initial.md` ← **new file**; example first entry
- `src/app/api/changelog/route.ts` ← **new file**; GET handler
- `src/components/changelog/changelog-dialog.tsx` ← **new file**; dialog component
- `src/components/shared/app-sidebar.tsx` ← add button + state + dialog mount
- `package.json` (via `pnpm add react-markdown remark-gfm`) ← dependency addition

**Out of scope** (do NOT touch):
- Any existing API routes — do not modify route auth patterns elsewhere
- `src/lib/stores/` — no Zustand store is needed; local `useState` in the sidebar is sufficient (see pattern above)
- Any existing dialog component files under `src/components/ui/`
- The dashboard layout (`src/app/app/layout.tsx`) — the dialog mounts inside the sidebar component, not the layout
- `tailwind.config.*` or CSS config — do NOT add `@tailwindcss/typography`; style markdown elements via the `components` prop of ReactMarkdown

## Git workflow

- Branch: `advisor/053-changelog-viewer`
- Commit style (match repo): `feat: add changelog viewer to sidebar` (conventional commits, imperative mood, lowercase after colon)
- Do NOT push or open a PR unless instructed.

---

## Steps

### Step 1: Install markdown rendering dependencies

Run:
```bash
pnpm add react-markdown remark-gfm
```

**Verify**: `pnpm typecheck` exits 0 (the packages ship their own types; no `@types/*` needed).

---

### Step 2: Create the changelog content directory and a first entry

Create the directory `src/content/changelog/` and add the first changelog file.

**Naming convention for all future entries**: `YYYY-MM-DD-<slug>.md`
- Date prefix is how the API route sorts entries (descending = newest first).
- The first `# Heading` line in each file becomes the entry title in the UI.
- No frontmatter; the filename carries the date.

**Create `src/content/changelog/2026-06-24-initial.md`**:

```markdown
# MCP Server & Personal Access Tokens

Added a read-only MCP (Model Context Protocol) server that exposes S3 operations
through S3Dock, enabling AI assistants and automation tools to interact with your
storage buckets. Paired with a new **Personal Access Tokens** system so non-browser
clients can authenticate without session cookies.

## What's new

- **Personal Access Tokens (PAT)** — generate long-lived tokens from the Settings page
  for use in scripts, CI, and the MCP server.
- **MCP server** — a stdio-transport MCP server (`src/mcp/`) exposing `list_buckets`,
  `list_objects`, `get_object_info`, and `presign_object` tools.
- **Team invite links** — team admins can now generate a shareable invite URL to onboard
  members who have not yet created an account.
- **Error boundaries and 404 page** — unhandled errors now show a branded recovery screen
  instead of a blank page.
```

Add more entries as the app grows: create one file per release, always with the `YYYY-MM-DD-` prefix and a single `# Title` at the top.

**Verify**: `ls src/content/changelog/` lists `2026-06-24-initial.md`.

---

### Step 3: Create the API route

Create `src/app/api/changelog/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";

export interface ChangelogEntry {
  date: string;
  slug: string;
  title: string;
  content: string;
}

export async function GET() {
  const dir = path.join(process.cwd(), "src/content/changelog");

  let filenames: string[];
  try {
    filenames = (await readdir(dir))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse(); // newest first
  } catch {
    return NextResponse.json({ entries: [] });
  }

  const entries: ChangelogEntry[] = await Promise.all(
    filenames.map(async (filename) => {
      const raw = await readFile(path.join(dir, filename), "utf-8");
      const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : "";
      const titleMatch = raw.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : filename.replace(/\.md$/, "");
      return { date, slug: filename.replace(/\.md$/, ""), title, content: raw };
    })
  );

  return NextResponse.json({ entries });
}
```

**Verify**:
1. `pnpm typecheck` exits 0.
2. With the dev server running (`pnpm dev`), `curl http://localhost:3000/api/changelog` returns JSON with `{ "entries": [{ "date": "2026-06-24", "slug": "2026-06-24-initial", "title": "MCP Server & Personal Access Tokens", "content": "..." }] }`.

---

### Step 4: Create the ChangelogDialog component

Create `src/components/changelog/changelog-dialog.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChangelogEntry } from "@/app/api/changelog/route";

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangelogDialog({ open, onOpenChange }: ChangelogDialogProps) {
  const { data, isLoading } = useQuery<{ entries: ChangelogEntry[] }>({
    queryKey: ["changelog"],
    queryFn: async () => {
      const res = await fetch("/api/changelog");
      if (!res.ok) throw new Error("Failed to fetch changelog");
      return res.json();
    },
    enabled: open,
    staleTime: Infinity,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Changelog</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-8 pr-1">
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {!isLoading && !data?.entries.length && (
            <p className="text-sm text-muted-foreground">No changelog entries yet.</p>
          )}

          {data?.entries.map((entry) => (
            <section key={entry.slug} className="pb-8 border-b last:border-0 last:pb-0">
              <div className="flex items-baseline gap-3 mb-4">
                <time
                  dateTime={entry.date}
                  className="text-xs font-medium text-muted-foreground tabular-nums"
                >
                  {entry.date}
                </time>
              </div>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-base font-semibold text-foreground mb-3 mt-0">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-sm font-semibold text-foreground mb-2 mt-5">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-medium text-foreground mb-2 mt-4">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside text-sm text-muted-foreground mb-3 space-y-1 ml-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside text-sm text-muted-foreground mb-3 space-y-1 ml-1">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-sm text-muted-foreground leading-relaxed">
                      {children}
                    </li>
                  ),
                  code: ({ children }) => (
                    <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono text-foreground">
                      {children}
                    </code>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-muted-foreground">{children}</em>
                  ),
                  hr: () => <hr className="border-border my-4" />,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {entry.content}
              </ReactMarkdown>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Verify**: `pnpm typecheck` exits 0.

---

### Step 5: Wire the button and dialog into the sidebar

Open `src/components/shared/app-sidebar.tsx` and make three edits:

**Edit A — add `ScrollText` to the lucide-react import** (line 37–52):

```tsx
// Before
import {
  Database,
  Settings,
  Users,
  Plug,
  ChevronRight,
  ChevronDown,
  Briefcase,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  GripVertical,
  Link2,
  CreditCard,
} from "lucide-react";

// After — add ScrollText
import {
  Database,
  Settings,
  Users,
  Plug,
  ChevronRight,
  ChevronDown,
  Briefcase,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  GripVertical,
  Link2,
  CreditCard,
  ScrollText,
} from "lucide-react";
```

**Edit B — add the ChangelogDialog import** after the existing Dialog import block (around line 28):

```tsx
import { ChangelogDialog } from "@/components/changelog/changelog-dialog";
```

**Edit C — add `changelogOpen` state** alongside the existing connection dialog states (find `useState<ConnectionResponse | null>(null)` — around line ~80–100 depending on component body start):

```tsx
const [changelogOpen, setChangelogOpen] = useState(false);
```

**Edit D — add the Changelog button** inside the `<div className="p-4 border-t space-y-1">` section, after the Billing link (line 538):

```tsx
{/* existing Billing link ends here */}
          </Link>
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-sidebar-foreground hover:bg-sidebar-accent/50 w-full text-left"
          >
            <ScrollText className="h-4 w-4 shrink-0" />
            Changelog
          </button>
        </div>
```

**Edit E — mount the ChangelogDialog** alongside the existing `{/* Edit dialog */}` and `{/* Delete confirmation dialog */}` blocks at the bottom of the component return (after line 597, before the closing `</>`):

```tsx
      {/* Changelog dialog */}
      <ChangelogDialog
        open={changelogOpen}
        onOpenChange={setChangelogOpen}
      />
    </>
  );
}
```

**Verify**: `pnpm typecheck` exits 0; `pnpm lint` exits 0.

---

### Step 6: Final smoke test

1. Run `pnpm dev`.
2. Open the app in a browser and navigate to any page with the sidebar visible.
3. Confirm a "Changelog" button appears at the bottom of the sidebar (below Billing).
4. Click the button — the dialog opens, shows the "2026-06-24-initial" entry with the correct date and formatted content.
5. Close the dialog with `Escape` or the ✕ button — focus returns to the sidebar button.
6. No console errors in the browser dev tools.

---

## Test plan

No unit tests are required for this feature. The logic is thin (file read + JSON, simple component). Manual smoke (step 6) is sufficient.

If the project later adopts integration tests for API routes (there is no test file for any API route today), model the test after `src/lib/s3/client.test.ts` or any existing Vitest test file, mocking `fs/promises.readdir` and `readFile`.

**Verify**: `pnpm test` exits 0 (no new or broken tests).

---

## Done criteria

All of the following must hold before marking the plan DONE:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0
- [ ] `curl http://localhost:3000/api/changelog` (with dev server running) returns `{ "entries": [...] }` with at least one entry
- [ ] The Changelog button is visible in the sidebar below the Billing link
- [ ] Clicking the button opens a dialog that renders the markdown content
- [ ] Dialog closes on `Escape` and on ✕ click
- [ ] `git status` shows only the in-scope files modified (no unintended changes)
- [ ] `plans/README.md` status row for plan 053 updated to DONE

---

## STOP conditions

Stop and report back (do not improvise) if:

- The sidebar's bottom `<div className="p-4 border-t space-y-1">` section does not match the "Current state" excerpt — the file has drifted.
- `ScrollText` is not found in the installed `lucide-react` package — substitute `BookOpen` or `FileText`, which are always available, and note the substitution.
- `pnpm typecheck` fails after step 4 with errors inside `react-markdown` or `remark-gfm` types — do not patch the types; report back.
- Step 6 manual test shows the dialog open but empty (no entries rendered despite the API returning data) — do not debug React Query cache behavior; report back.

---

## Maintenance notes

- **Adding a new release**: create `src/content/changelog/YYYY-MM-DD-<slug>.md` with a `# Title` as the first line. The API route picks it up automatically; no code changes needed.
- **File location**: `src/content/changelog/` is inside `src/` and therefore included in the production deployment. Do not move it to `public/` (that would expose raw `.md` files as public downloads).
- **QueryClient cache**: `staleTime: Infinity` means the changelog is fetched once per browser session after first opening the dialog. If you release a changelog update and want users to see it without a full page reload, lower `staleTime` to `1000 * 60 * 60` (1 hour) or accept the once-per-session behavior.
- **Accessibility**: The `<button>` in the sidebar already participates in the tab order. The Dialog uses Radix's built-in focus trap and ARIA role. No additional a11y work is needed.
- **Icon choice**: `ScrollText` (lucide-react) was chosen for semantic clarity. If the design ever needs an icon review, `BookOpen` or `History` are the alternates that read as "past events / record."
