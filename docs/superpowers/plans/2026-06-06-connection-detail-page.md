# Connection Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `/connections/[id]/health` page with a tabbed connection settings page that mirrors the bucket detail page layout. v1 ships two tabs — Overview (connection info + inline Edit dialog + permissions summary card) and Permissions (existing full health report). The page is reached via the connection card's three-dots menu → Settings.

**Architecture:** New dashboard route `/connections/[id]?tab=…`. A `ConnectionDetailTabs` client component routes between two tab definitions, mirroring `BucketDetailTabs` in structure (Back link → title row with icon → tab nav → tab body). Overview renders a `ConnectionIdentityCard` (which embeds an Edit `Dialog` wrapping the existing `ConnectionForm`) and a `ConnectionPermissionsSummaryCard` modeled on the bucket `PermissionsCard`. Permissions tab embeds the existing `HealthReportView`. The old `/connections/[id]/health` route becomes a server-side redirect to `/connections/[id]?tab=permissions`, matching the equivalent bucket redirect at `src/app/(dashboard)/buckets/[connectionId]/[bucket]/health/page.tsx`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query 5, Tailwind, Radix UI, Lucide icons.

---

## File Map

| Path | Op | Responsibility |
|---|---|---|
| `src/app/(dashboard)/connections/[id]/page.tsx` | Create | Server-component route shell + `Suspense` boundary |
| `src/components/connections/connection-detail-tabs.tsx` | Create | Client header + tab nav + active-tab renderer |
| `src/components/connections/connection-identity-card.tsx` | Create | Connection info card with inline Edit dialog |
| `src/components/connections/connection-permissions-summary-card.tsx` | Create | Card showing permission status with link to Permissions tab |
| `src/components/connections/connection-overview-tab.tsx` | Create | Composes identity card + summary cards grid |
| `src/components/connections/connection-permissions-tab.tsx` | Create | Wraps `HealthReportView` for connection scope |
| `src/app/(dashboard)/connections/[id]/health/page.tsx` | Modify | Replace existing page body with a `redirect()` to `?tab=permissions` |
| `src/components/connections/connection-list.tsx` | Modify | Show dropdown for all roles; add "Settings" item; remove the footer Health-check link |
| `src/components/health/capability-gate.tsx` | Modify | Update connection report href to `/connections/[id]?tab=permissions` |

---

## Task 1: Create the route shell

**Files:**
- Create: `src/app/(dashboard)/connections/[id]/page.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { Suspense } from "react";
import { ConnectionDetailTabs } from "@/components/connections/connection-detail-tabs";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConnectionDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <Suspense fallback={null}>
      <ConnectionDetailTabs connectionId={id} />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm build`
Expected: PASS (the route will fail to import `ConnectionDetailTabs` until Task 2; if so, defer build until Task 2 completes and confirm here).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/connections/[id]/page.tsx"
git commit -m "feat(connections): add detail page route shell"
```

---

## Task 2: Create `ConnectionDetailTabs`

**Files:**
- Create: `src/components/connections/connection-detail-tabs.tsx`

Defines the URL-driven tab system. Tabs render placeholder strings until Tasks 5 and 6; this lets us visit the page early and confirm routing works.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart3, Lock, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnections } from "@/lib/queries/connections";

const TAB_DEFINITIONS = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "permissions", label: "Permissions", icon: Lock },
] as const;

type TabKey = (typeof TAB_DEFINITIONS)[number]["key"];

function isTabKey(value: string | null): value is TabKey {
  return TAB_DEFINITIONS.some((t) => t.key === value);
}

interface ConnectionDetailTabsProps {
  connectionId: string;
}

export function ConnectionDetailTabs({ connectionId }: ConnectionDetailTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: TabKey = isTabKey(rawTab) ? rawTab : "overview";

  const { data: connections = [] } = useConnections();
  const connection = connections.find((c) => c.id === connectionId);
  const displayName = connection?.name || connection?.endpoint || "Connection";
  const showEndpointSubtitle = !!(connection?.name && connection?.endpoint);

  const setTab = (key: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.push(`/connections/${connectionId}?${params.toString()}`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="border-b px-6 py-4 space-y-3 pb-0">
        <Link
          href="/connections"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to connections
        </Link>
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-muted-foreground shrink-0" />
          <h1 className="text-xl font-semibold truncate">{displayName}</h1>
          {showEndpointSubtitle && (
            <span className="text-xs text-muted-foreground truncate">
              · {connection!.endpoint}
            </span>
          )}
        </div>
        <nav className="flex items-center gap-1 -mb-px">
          {TAB_DEFINITIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-sm border-b-2 transition-colors",
                key === activeTab
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "overview" && (
          <div className="text-sm text-muted-foreground">Overview placeholder</div>
        )}
        {activeTab === "permissions" && (
          <div className="text-sm text-muted-foreground">Permissions placeholder</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke-test the route**

Start the dev server (`pnpm dev`) and navigate to `/connections/<any-existing-connection-id>`. Expected:
- Back-to-connections link visible
- Server icon + connection display name
- Two tabs "Overview" and "Permissions" with "Overview" active by default
- Clicking "Permissions" changes the URL to `?tab=permissions` and switches the placeholder body
- Reloading on `?tab=permissions` keeps the tab active

- [ ] **Step 3: Commit**

```bash
git add src/components/connections/connection-detail-tabs.tsx
git commit -m "feat(connections): add tabbed detail container"
```

---

## Task 3: Create `ConnectionIdentityCard`

**Files:**
- Create: `src/components/connections/connection-identity-card.tsx`

Shows connection info as a definition list, with an Edit button visible to ADMIN users that opens the existing `ConnectionForm` inside a `Dialog`. Mirrors the bucket `OverviewIdentityCard` `Row` pattern.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useState } from "react";
import { Briefcase, Pencil, Server, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatDate } from "@/lib/utils";
import { useConnections } from "@/lib/queries/connections";
import { useWorkspaces } from "@/lib/queries/workspaces";
import { ConnectionForm } from "./connection-form";

interface ConnectionIdentityCardProps {
  connectionId: string;
}

function Row({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 py-1.5", className)}>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground w-32 shrink-0">
        {label}
      </dt>
      <dd className={cn("text-sm min-w-0 flex-1", valueClassName ?? "truncate")}>
        {value}
      </dd>
    </div>
  );
}

export function ConnectionIdentityCard({
  connectionId,
}: ConnectionIdentityCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const { data: connections = [] } = useConnections();
  const { data: workspaces = [] } = useWorkspaces();
  const connection = connections.find((c) => c.id === connectionId);
  const workspace = workspaces.find((w) => w.id === connection?.workspaceId);
  const canEdit = connection?.role === "ADMIN";

  if (!connection) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 min-w-0">
          <Server className="h-5 w-5 text-muted-foreground shrink-0" />
          <span className="truncate">
            {connection.name || connection.endpoint}
          </span>
        </CardTitle>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs shrink-0"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <dl>
          <Row
            label="Name"
            value={
              connection.name || (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <Row
            label="Endpoint"
            value={
              <span className="block font-mono text-xs truncate">
                {connection.endpoint}
              </span>
            }
          />
          <Row
            label="Region"
            value={
              connection.region || (
                <span className="text-muted-foreground">Unknown</span>
              )
            }
          />
          <Row
            label="Access key"
            value={
              <span className="block font-mono text-xs truncate">
                {connection.accessKeyId}
              </span>
            }
          />
          <Row
            label="Path style"
            value={
              connection.forcePathStyle
                ? "Force path style (path-based)"
                : "Virtual-hosted"
            }
          />
          <Row
            label="Workspace"
            value={
              workspace ? (
                <span className="inline-flex items-center gap-1.5">
                  {workspace.type === "TEAM" ? (
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  {workspace.name}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <Row
            label="Role"
            value={
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] uppercase tracking-wide"
              >
                {connection.role}
              </Badge>
            }
          />
          <Row
            label="Created"
            value={
              connection.createdAt ? (
                formatDate(connection.createdAt)
              ) : (
                <span className="text-muted-foreground">Unknown</span>
              )
            }
          />
        </dl>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Edit connection</DialogTitle>
          </DialogHeader>
          <ConnectionForm
            connection={connection}
            onSuccess={() => setEditOpen(false)}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/connections/connection-identity-card.tsx
git commit -m "feat(connections): add identity card with inline edit"
```

---

## Task 4: Create `ConnectionPermissionsSummaryCard`

**Files:**
- Create: `src/components/connections/connection-permissions-summary-card.tsx`

Mirrors the bucket `PermissionsCard` shape, but uses the connection-level health hooks. Lazily fires a POST when there is no persisted record, just like the bucket version.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useConnectionHealth,
  useRunConnectionHealth,
} from "@/lib/queries/health";

interface ConnectionPermissionsSummaryCardProps {
  connectionId: string;
}

export function ConnectionPermissionsSummaryCard({
  connectionId,
}: ConnectionPermissionsSummaryCardProps) {
  const pathname = usePathname();
  const { data: report, isLoading, isError } = useConnectionHealth(connectionId);
  const runHealth = useRunConnectionHealth();

  useEffect(() => {
    if (!isLoading && !isError && report === null && !runHealth.isPending) {
      runHealth.mutate({ connectionId });
    }
  }, [isLoading, isError, report, runHealth, connectionId]);

  if (isLoading || (report === null && runHealth.isPending)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            Running initial permission check…
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (isError || (report === null && !runHealth.isPending)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-2">
            Couldn&apos;t complete the permission check.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runHealth.mutate({ connectionId })}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!report) return null;

  const available = report.capabilities.filter((c) => c.status === "available").length;
  const unavailable = report.capabilities.filter((c) => c.status === "unavailable").length;
  const unsupported = report.capabilities.filter((c) => c.status === "unsupported").length;
  const total = report.capabilities.length;
  const permissionsHref = `${pathname}?tab=permissions`;
  const allAvailable =
    total > 0 && available === total && report.connectivity === "ok";

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Permissions
        </CardTitle>
        {!allAvailable && (
          <>
            <p className="text-xs text-muted-foreground mt-0.5">
              {available} of {total} available
              {unavailable > 0 ? ` · ${unavailable} unavailable` : ""}
              {unsupported > 0 ? ` · ${unsupported} unsupported` : ""}
            </p>
            {report.connectivity !== "ok" && (
              <p className="text-xs text-yellow-600 mt-1">Endpoint unreachable</p>
            )}
          </>
        )}
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        {allAvailable ? (
          <div className="flex flex-col flex-1 items-center justify-center text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mb-3" />
            <p className="text-sm font-semibold mb-1">All permissions available</p>
            <p className="text-sm text-muted-foreground mb-3">
              All {total} actions are ready to use.
            </p>
            <Link
              href={permissionsHref}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View permissions
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <Link
            href={permissionsHref}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View permissions
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/connections/connection-permissions-summary-card.tsx
git commit -m "feat(connections): add permissions summary card"
```

---

## Task 5: Create `ConnectionOverviewTab`

**Files:**
- Create: `src/components/connections/connection-overview-tab.tsx`

Composes the identity card and a grid that contains the permissions summary card. The grid is set up to hold additional cards (storage stats, activity) in a later iteration without restructuring.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { ConnectionIdentityCard } from "./connection-identity-card";
import { ConnectionPermissionsSummaryCard } from "./connection-permissions-summary-card";

interface ConnectionOverviewTabProps {
  connectionId: string;
}

export function ConnectionOverviewTab({
  connectionId,
}: ConnectionOverviewTabProps) {
  return (
    <div className="space-y-4">
      <ConnectionIdentityCard connectionId={connectionId} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConnectionPermissionsSummaryCard connectionId={connectionId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `ConnectionDetailTabs`**

In `src/components/connections/connection-detail-tabs.tsx`, replace the overview placeholder:

```tsx
        {activeTab === "overview" && (
          <div className="text-sm text-muted-foreground">Overview placeholder</div>
        )}
```

With:

```tsx
        {activeTab === "overview" && (
          <ConnectionOverviewTab connectionId={connectionId} />
        )}
```

And add the import at the top of the file:

```tsx
import { ConnectionOverviewTab } from "./connection-overview-tab";
```

- [ ] **Step 3: Smoke-test**

Start dev server, navigate to `/connections/<id>`. Expected on the Overview tab:
- Identity card with all rows populated
- Edit button visible for ADMIN connections, hidden for VIEWER
- Clicking Edit opens the `ConnectionForm` dialog pre-populated; saving closes the dialog and updates the card
- Permissions summary card renders (or fires the initial check the first time)
- Clicking "View permissions" link in summary card switches URL to `?tab=permissions` (currently still placeholder text — that's fine, Task 6 fixes it)

- [ ] **Step 4: Commit**

```bash
git add src/components/connections/connection-overview-tab.tsx src/components/connections/connection-detail-tabs.tsx
git commit -m "feat(connections): render overview tab on detail page"
```

---

## Task 6: Create `ConnectionPermissionsTab`

**Files:**
- Create: `src/components/connections/connection-permissions-tab.tsx`

Lifts the body of the current `/connections/[id]/health/page.tsx` into a tab component. Adds the same lazy-run behavior on first visit (matches `PermissionsTab` for buckets).

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/lib/queries/connections";
import {
  useConnectionHealth,
  useRunConnectionHealth,
} from "@/lib/queries/health";
import { HealthReportView } from "@/components/health/health-report";

interface ConnectionPermissionsTabProps {
  connectionId: string;
}

export function ConnectionPermissionsTab({
  connectionId,
}: ConnectionPermissionsTabProps) {
  const { data: connections = [] } = useConnections();
  const connection = connections.find((c) => c.id === connectionId);
  const { data: report, isLoading, isError } = useConnectionHealth(connectionId);
  const runHealth = useRunConnectionHealth();

  useEffect(() => {
    if (!isLoading && !isError && report === null && !runHealth.isPending) {
      runHealth.mutate({ connectionId });
    }
  }, [isLoading, isError, report, runHealth, connectionId]);

  if (isLoading || (report === null && runHealth.isPending)) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Running initial permission check…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        Couldn&apos;t load the report.{" "}
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => runHealth.mutate({ connectionId })}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (report) {
    return (
      <HealthReportView
        report={report}
        endpoint={connection?.endpoint}
        onRefresh={() => runHealth.mutate({ connectionId })}
        isRefreshing={runHealth.isPending}
      />
    );
  }

  return null;
}
```

- [ ] **Step 2: Wire into `ConnectionDetailTabs`**

In `src/components/connections/connection-detail-tabs.tsx`, replace the permissions placeholder:

```tsx
        {activeTab === "permissions" && (
          <div className="text-sm text-muted-foreground">Permissions placeholder</div>
        )}
```

With:

```tsx
        {activeTab === "permissions" && (
          <ConnectionPermissionsTab connectionId={connectionId} />
        )}
```

And add the import at the top of the file:

```tsx
import { ConnectionPermissionsTab } from "./connection-permissions-tab";
```

- [ ] **Step 3: Smoke-test**

Navigate to `/connections/<id>?tab=permissions`. Expected:
- Full `HealthReportView` renders with the same content as the old `/connections/[id]/health` page
- Refresh button works
- Stale banner and unreachable banner still render under the same conditions
- "View permissions" link from the Overview summary card now lands on a usable Permissions tab

- [ ] **Step 4: Commit**

```bash
git add src/components/connections/connection-permissions-tab.tsx src/components/connections/connection-detail-tabs.tsx
git commit -m "feat(connections): render permissions tab on detail page"
```

---

## Task 7: Replace the old `/connections/[id]/health` page with a redirect

**Files:**
- Modify: `src/app/(dashboard)/connections/[id]/health/page.tsx`

Old route stays valid for any bookmarked URL or in-flight link (e.g. `CapabilityGate` until Task 9). It now redirects to the new tab.

- [ ] **Step 1: Overwrite the file**

Replace the entire file content with:

```tsx
import { redirect } from "next/navigation";

export default async function ConnectionHealthRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/connections/${id}?tab=permissions`);
}
```

- [ ] **Step 2: Verify behavior**

Run `pnpm dev` and visit `/connections/<id>/health`. Expected: instant redirect to `/connections/<id>?tab=permissions` with the Permissions tab rendering the report.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/connections/[id]/health/page.tsx"
git commit -m "refactor(connections): redirect legacy health URL to permissions tab"
```

---

## Task 8: Update `connection-list.tsx` — Settings in dropdown, remove footer link

**Files:**
- Modify: `src/components/connections/connection-list.tsx`

Three behavioral changes on each connection card:
1. The three-dots dropdown is shown for **all** users (currently only ADMINs see it).
2. A new "Settings" item links to `/connections/<id>?tab=overview` and is visible to all users.
3. The footer "Health check" link is removed (Settings → Permissions tab replaces it).

Edit and Delete items remain ADMIN-only inside the dropdown.

- [ ] **Step 1: Update imports**

Find the lucide-react import block at the top:

```tsx
import {
  MoreVertical,
  Pencil,
  Trash2,
  Plus,
  Server,
  Loader2,
  Briefcase,
  Users,
  ShieldCheck,
} from "lucide-react";
```

Replace it with (add `Settings`, remove `ShieldCheck`):

```tsx
import {
  MoreVertical,
  Pencil,
  Trash2,
  Plus,
  Server,
  Loader2,
  Briefcase,
  Users,
  Settings,
} from "lucide-react";
```

- [ ] **Step 2: Replace the card body (dropdown + footer)**

Find this block inside the `wsConns.map((connection) => ( … ))`:

```tsx
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {getDisplayName(connection)}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5">
                          {connection.role}
                        </span>
                      </div>
                      {canManage(connection) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => onEdit(connection)}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeletingConnection(connection)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate pl-6">
                      {connection.endpoint}
                    </p>
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

Replace it with:

```tsx
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {getDisplayName(connection)}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5">
                          {connection.role}
                        </span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/connections/${connection.id}?tab=overview`}
                            >
                              <Settings className="h-4 w-4" />
                              Settings
                            </Link>
                          </DropdownMenuItem>
                          {canManage(connection) && (
                            <>
                              <DropdownMenuItem
                                onClick={() => onEdit(connection)}
                              >
                                <Pencil className="h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setDeletingConnection(connection)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate pl-6">
                      {connection.endpoint}
                    </p>
```

- [ ] **Step 3: Smoke-test**

Restart `pnpm dev` if needed. Expected on the `/connections` page:
- Every connection card shows the three-dots button (both ADMIN and VIEWER connections)
- Dropdown opens with "Settings" as the first item for everyone; clicking it navigates to `/connections/<id>?tab=overview`
- For ADMIN connections, "Edit" and "Delete" appear below Settings; for VIEWER connections, only "Settings" is shown
- The bottom-of-card "Health check" link is gone
- Edit dialog still opens and saves when invoked from the dropdown

- [ ] **Step 4: Commit**

```bash
git add src/components/connections/connection-list.tsx
git commit -m "feat(connections): replace health link with Settings dropdown item"
```

---

## Task 9: Point `CapabilityGate` connection report at the new URL

**Files:**
- Modify: `src/components/health/capability-gate.tsx:55`

The capability tooltip shows a "View permission report" link. For bucket scope it already points at `?tab=permissions`. Update the connection-scope branch to the new URL.

- [ ] **Step 1: Edit the `reportHref` assignment**

Find these lines in `src/components/health/capability-gate.tsx`:

```tsx
  const reportHref = bucket
    ? `/buckets/${connectionId}/${encodeURIComponent(bucket)}?tab=permissions`
    : `/connections/${connectionId}/health`;
```

Replace with:

```tsx
  const reportHref = bucket
    ? `/buckets/${connectionId}/${encodeURIComponent(bucket)}?tab=permissions`
    : `/connections/${connectionId}?tab=permissions`;
```

- [ ] **Step 2: Smoke-test**

Find a UI surface that gates a connection-level capability (e.g. the "Add Connection" button area, or any spot using `<CapabilityGate>` without a `bucket` prop) and hover the disabled element. Expected: the tooltip's "View permission report" link now resolves to `/connections/<id>?tab=permissions` and renders the Permissions tab directly (no extra redirect hop).

- [ ] **Step 3: Commit**

```bash
git add src/components/health/capability-gate.tsx
git commit -m "refactor(health): point capability gate at new connection permissions tab"
```

---

## Self-Review (after implementation is complete)

After all tasks are merged, sanity-check:

- **Coverage:** Every spec line from the user request has a task:
  - Tabbed layout matching bucket detail page → Tasks 1, 2
  - Overview tab w/ connection info + Edit button → Tasks 3, 5
  - Permissions tab containing the existing report → Tasks 6, 7
  - Three-dots → Settings (Settings + Edit + Delete kept per design choice) → Task 8
  - "Health check" footer link removed → Task 8
  - Edit button "somewhere" inside Settings → Task 3 (inside identity card)
  - Connection info shown in Settings → Task 3

- **Type consistency:** `ConnectionDetailTabs` exports the same prop name (`connectionId`) used by every tab component, identity card, and summary card. The route shell passes `id` from the URL into `connectionId`.

- **Dead links:** The old route still works (redirect from Task 7). `CapabilityGate` is updated (Task 9). No other place in the repo links to `/connections/<id>/health` (verified by grep before plan).

- **Permissions parity with current behavior:** The dropdown is now shown for all roles (previously only ADMIN). That's intentional — VIEWERs need a way into Settings/Permissions. Edit and Delete remain gated to ADMIN.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-06-connection-detail-page.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
