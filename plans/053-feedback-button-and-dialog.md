# Plan 053: Add Feedback Button and Dialog to the Sidebar

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 04e4c30..HEAD -- prisma/schema.prisma src/components/shared/app-sidebar.tsx src/app/app/layout.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `04e4c30`, 2026-06-24

## Why this matters

Users who hit a bug or want to suggest an improvement currently have no in-app
path to reach the developer. A feedback button in the sidebar gives every user
a one-click way to submit a message without leaving the app. Submissions are
persisted in the database so the developer can review them at any time with no
third-party service required.

## Current state

### Relevant files

- `prisma/schema.prisma` — Prisma schema; the `Feedback` model and
  `FeedbackType` enum must be added here.
- `src/components/shared/app-sidebar.tsx` — sidebar component; the bottom
  section (lines 513–540) already contains Settings and Billing links and is
  where the feedback trigger button will be added.
- `src/app/app/layout.tsx` — dashboard shell; the `FeedbackDialog` component
  will be mounted here alongside existing global modals (e.g. `PlansModal`).
- `src/app/api/feedback/route.ts` — does not exist; create it.
- `src/components/shared/feedback-dialog.tsx` — does not exist; create it.
- `src/components/ui/textarea.tsx` — does not exist; create it.

### Sidebar bottom section (app-sidebar.tsx:513–540)

```tsx
// src/components/shared/app-sidebar.tsx:513
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
            ...
          >
            <CreditCard className="h-4 w-4" />
            Billing
          </Link>
        </div>
```

The `FeedbackDialog` trigger button goes **below** the Billing link in this
`<div>`, before the closing `</div>`.

### Dashboard layout (app/layout.tsx:12–42)

```tsx
// src/app/app/layout.tsx — global modal mount point
      <CommandPaletteMount />
      <PlansModal />
    </DragProvider>
```

The `<FeedbackDialog />` will be mounted between `<PlansModal />` and
`</DragProvider>`.

### API auth pattern

API routes are protected with `withAuth` from `@/lib/auth`. The handler
receives `{ user: AuthUser }` where `user.id` is the database UUID and
`user.email` is the email string. Match this pattern exactly — see
`src/app/api/connections/route.ts:16` for a minimal example.

### Dialog component pattern

Self-contained dialog with controlled open state, `useNotificationStore` for
success/error toasts. The canonical example is
`src/components/browser/create-folder-dialog.tsx`. Key conventions to match:
- `"use client"` directive at the top.
- `const [open, setOpen] = useState(false)` for internal state; open is also
  exportable via props `open?: boolean` / `onOpenChange?: (open: boolean) => void`
  for external control if needed (keep it simple — internal state is fine here).
- Import `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`,
  `DialogDescription`, `DialogFooter` from `@/components/ui/dialog`.
- Import `Button` from `@/components/ui/button`.
- Use `addNotification` from `useNotificationStore` for success and error states.

### Validation

The project uses `zod` (v4, already in `package.json`). Match the import style
used in the existing API routes: `import { z } from "zod"`.

## Commands you will need

| Purpose    | Command                                              | Expected on success          |
|------------|------------------------------------------------------|------------------------------|
| Generate   | `pnpm prisma generate`                               | exit 0                       |
| Migrate    | `pnpm prisma migrate dev --name add_feedback`        | migration created, exit 0    |
| Typecheck  | `pnpm tsc --noEmit`                                  | exit 0, no errors            |
| Lint       | `pnpm lint`                                          | exit 0                       |
| Dev server | `pnpm dev`                                           | server starts on port 3000   |

## Suggested executor toolkit

- Use the `vercel-react-best-practices` skill when writing the React component
  if available.
- Check `src/components/browser/create-folder-dialog.tsx` before writing the
  dialog to match its exact code style.

## Scope

**In scope** (the only files you should modify or create):

- `prisma/schema.prisma` — add enum + model
- `prisma/migrations/<timestamp>_add_feedback/` — generated migration (do not hand-write; let `prisma migrate dev` create it)
- `src/components/ui/textarea.tsx` — new file
- `src/app/api/feedback/route.ts` — new file
- `src/components/shared/feedback-dialog.tsx` — new file
- `src/components/shared/app-sidebar.tsx` — add import and trigger button only
- `src/app/app/layout.tsx` — add import and mount `<FeedbackDialog />`

**Out of scope** (do NOT touch):

- Any other Prisma model — the schema change is additive only.
- Any existing API route — do not refactor them.
- `src/components/ui/dialog.tsx` — already exists and works; do not modify.
- Any admin view — the developer can query the `Feedback` table directly.
- Email delivery — out of scope for this plan; add a `// TODO: email notification` comment in the API route if desired.

## Git workflow

- Branch: `advisor/053-feedback-button-and-dialog`
- Commit style: `feat: <description>` (conventional commits, matching `44e21da feat: ...` from git log)
- One commit per logical step is fine; a single clean commit is also acceptable.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `Feedback` model to Prisma schema

Open `prisma/schema.prisma`. After the last enum in the file (search for
the final `enum` block — currently `ActivityAction`) and before the last model,
add the following enum and model. The exact position doesn't matter as long as
it's at the top level.

**Add the enum** (place it near the other enums at the top of the file, after
`ActivityAction`):

```prisma
enum FeedbackType {
  FEEDBACK
  BUG_REPORT
}
```

**Add the model** (place it at the end of the schema, after the last existing
model):

```prisma
model Feedback {
  id      String       @id @default(uuid())
  type    FeedbackType
  message String

  userId String?
  user   User?  @relation(fields: [userId], references: [id], onDelete: SetNull)

  userEmail String?

  createdAt DateTime @default(now())
}
```

Also add the back-relation to the `User` model. Find the `model User {` block
and add the following line inside it (alongside the other relation fields):

```prisma
  feedbacks Feedback[]
```

**Verify**: `pnpm prisma generate` → exits 0 with no errors.

### Step 2: Run the migration

```bash
pnpm prisma migrate dev --name add_feedback
```

This creates `prisma/migrations/<timestamp>_add_feedback/migration.sql` with an
`ALTER TABLE` / `CREATE TABLE` statement. The `Feedback` table must appear in
the generated SQL.

**Verify**: Command exits 0. The file
`prisma/migrations/*/migration.sql` exists and contains `CREATE TABLE "Feedback"`.

### Step 3: Create `src/components/ui/textarea.tsx`

Create a new file following the exact same pattern as
`src/components/ui/input.tsx`. The textarea uses a `<textarea>` element instead
of `<input>` and should support resizing via the `resize-none` class by default
(callers can override with `className`).

```tsx
// src/components/ui/textarea.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
```

**Verify**: `pnpm tsc --noEmit` exits 0.

### Step 4: Create `src/app/api/feedback/route.ts`

```ts
// src/app/api/feedback/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import { z } from "zod";

const feedbackSchema = z.object({
  type: z.enum(["FEEDBACK", "BUG_REPORT"]),
  message: z.string().min(1).max(5000),
});

export const POST = withAuth(async (req, { user }) => {
  const body = await req.json();
  const parsed = feedbackSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const feedback = await prisma.feedback.create({
    data: {
      type: parsed.data.type,
      message: parsed.data.message,
      userId: user.id,
      userEmail: user.email,
    },
  });

  return NextResponse.json({ id: feedback.id }, { status: 201 });
});
```

**Verify**: `pnpm tsc --noEmit` exits 0 after saving.

### Step 5: Create `src/components/shared/feedback-dialog.tsx`

The component renders a trigger button (passed as a child to `DialogTrigger`) and
the dialog with a form. The trigger button itself is passed from the caller
(sidebar), so the component accepts an optional `trigger` prop; or more simply,
export the dialog with its own built-in trigger since the placement is fixed.

Use the self-contained pattern from `create-folder-dialog.tsx`:

```tsx
// src/components/shared/feedback-dialog.tsx
"use client";

import { useState } from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useNotificationStore } from "@/lib/stores/notification-store";

type FeedbackType = "FEEDBACK" | "BUG_REPORT";

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("FEEDBACK");
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);
  const { addNotification } = useNotificationStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsPending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message: message.trim() }),
      });

      if (!res.ok) throw new Error("Failed to submit");

      addNotification({
        type: "folder",
        title: "Thanks for your feedback!",
        description: "Your message has been received.",
        status: "completed",
      });
      setMessage("");
      setType("FEEDBACK");
      setOpen(false);
    } catch {
      addNotification({
        type: "error",
        title: "Failed to submit feedback",
        error: "Please try again.",
        status: "error",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors w-full text-sidebar-foreground hover:bg-sidebar-accent/50"
        >
          <MessageSquare className="h-4 w-4" />
          Feedback
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Share a suggestion or report a bug. We read everything.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType("FEEDBACK")}
                className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  type === "FEEDBACK"
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-input text-muted-foreground hover:text-foreground"
                }`}
              >
                Suggestion
              </button>
              <button
                type="button"
                onClick={() => setType("BUG_REPORT")}
                className={`flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  type === "BUG_REPORT"
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-input text-muted-foreground hover:text-foreground"
                }`}
              >
                Bug Report
              </button>
            </div>
            <div>
              <Label htmlFor="feedback-message">
                {type === "BUG_REPORT" ? "Describe the bug" : "Your suggestion"}
              </Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  type === "BUG_REPORT"
                    ? "What happened? What did you expect?"
                    : "What would make S3 Dock better for you?"
                }
                className="mt-2 min-h-[120px]"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !message.trim()}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Verify**: `pnpm tsc --noEmit` exits 0.

### Step 6: Add `FeedbackDialog` to the sidebar

Open `src/components/shared/app-sidebar.tsx`.

**Add the import** at the top of the file, alongside the other local imports:

```ts
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
```

**Add the trigger in the bottom section**. The bottom `<div>` currently ends
with the Billing `<Link>`. Add `<FeedbackDialog />` as the next sibling, before
the closing `</div>`:

Find this block (around line 527):

```tsx
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

Replace with:

```tsx
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
          <FeedbackDialog />
        </div>
```

**Verify**: `pnpm tsc --noEmit` exits 0.

### Step 7: Mount `FeedbackDialog` in the dashboard layout

Open `src/app/app/layout.tsx`.

**Add the import**:

```ts
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
```

Wait — the `FeedbackDialog` already renders its own trigger button inside the
sidebar. Mounting it again in the layout would create a duplicate. **Skip the
layout mount.** The component is fully self-contained; the sidebar placement is
sufficient. The layout already imports it transitively through the sidebar.

Step 7 is a no-op — do not modify `layout.tsx`.

### Step 8: Final typecheck and lint

```bash
pnpm tsc --noEmit && pnpm lint
```

Both must exit 0 with no errors.

## Test plan

There are no existing unit tests for dialog components (the test suite covers
stores and utilities). No new tests are required for this plan. Manual
verification is the acceptance gate:

1. Start the dev server: `pnpm dev`
2. Navigate to `http://localhost:3000/app/buckets`
3. Confirm "Feedback" button appears in the sidebar below "Billing"
4. Click it — the dialog should open with two type-toggle buttons and a textarea
5. Select "Bug Report", type a message, click "Send"
6. Confirm the success toast appears and the dialog closes
7. Verify the submission in the database:
   ```sql
   SELECT * FROM "Feedback" ORDER BY "createdAt" DESC LIMIT 1;
   ```
8. Repeat with "Suggestion" type — confirm `type = 'FEEDBACK'` in the DB row
9. Submit with an empty textarea — the Send button should remain disabled (HTML5
   `required` + `disabled={!message.trim()}`)

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `prisma/migrations/*_add_feedback/migration.sql` exists and contains `CREATE TABLE "Feedback"`
- [ ] `src/components/ui/textarea.tsx` exists
- [ ] `src/app/api/feedback/route.ts` exists
- [ ] `src/components/shared/feedback-dialog.tsx` exists
- [ ] `src/components/shared/app-sidebar.tsx` contains `FeedbackDialog`
- [ ] No files outside the in-scope list are modified (`git diff --name-only HEAD`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The sidebar bottom section (`<div className="p-4 border-t space-y-1">`) no
  longer matches the excerpt in Step 6 — it may have been refactored.
- `pnpm prisma migrate dev` fails due to a pre-existing migration conflict — do
  not force-reset the database; report back.
- `pnpm tsc --noEmit` fails after Step 6 due to a type error in `app-sidebar.tsx`
  that is not directly related to the `FeedbackDialog` import — the file may
  have changed since this plan was written.
- The `User` model already has a `feedbacks` field (another plan may have added
  it concurrently).

## Maintenance notes

- **Email forwarding**: The API route logs submissions to the DB only. When an
  email service is added (e.g. Resend), the route can be extended to call
  `resend.emails.send(...)` after the `prisma.feedback.create` call.
- **Admin view**: Feedback rows are queryable directly in the database. If a
  UI is needed, a simple `/app/settings/feedback` page listing
  `prisma.feedback.findMany({ orderBy: { createdAt: "desc" } })` would suffice.
- **Rate limiting**: There is no rate limit on `POST /api/feedback`. The route
  is auth-gated (only signed-in users can submit), which provides implicit
  protection. Explicit rate limiting can be added later if abuse occurs.
- **Notification `type` field**: The success toast uses `type: "folder"` as a
  stand-in (the notification store's `type` field is for icon display, and
  "folder" maps to a neutral icon). If a dedicated feedback icon type is added
  to the store in the future, update the two `addNotification` calls here.
