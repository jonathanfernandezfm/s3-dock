"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/lib/stores/layout-store";
import { useSidebarStore } from "@/lib/stores/sidebar-store";
import { useWorkspaces } from "@/lib/queries/workspaces";
import {
  useConnections,
  useDeleteConnection,
  type ConnectionResponse,
} from "@/lib/queries/connections";
import { useNotificationStore } from "@/lib/stores/notification-store";
import { ConnectionForm } from "@/components/connections/connection-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: workspaces = [] } = useWorkspaces();
  const { data: connections = [] } = useConnections();
  const { collapsedWorkspaces, toggleWorkspace } = useSidebarStore();
  const { panes, focusedPaneId, resetTabToBuckets } = useLayoutStore();
  const deleteConnection = useDeleteConnection();
  const { addNotification } = useNotificationStore();

  const [editingConnection, setEditingConnection] =
    useState<ConnectionResponse | null>(null);
  const [deletingConnection, setDeletingConnection] =
    useState<ConnectionResponse | null>(null);

  const connectionsByWorkspace = connections.reduce<
    Record<string, ConnectionResponse[]>
  >((acc, conn) => {
    if (!acc[conn.workspaceId]) acc[conn.workspaceId] = [];
    acc[conn.workspaceId].push(conn);
    return acc;
  }, {});

  const isSettingsActive =
    pathname === "/settings" || pathname.startsWith("/settings/");
  const isConnectionsActive =
    pathname === "/connections" || pathname.startsWith("/connections/");
  const isTeamsActive = pathname === "/teams" || pathname.startsWith("/teams/");
  const isBucketsActive =
    pathname === "/buckets" ||
    pathname.startsWith("/buckets/") ||
    pathname.startsWith("/browser/");

  const handleBucketsClick = () => {
    const targetPaneId = focusedPaneId || Object.keys(panes)[0];
    if (targetPaneId) {
      const pane = panes[targetPaneId];
      if (pane?.activeTabId) {
        resetTabToBuckets(targetPaneId, pane.activeTabId);
      }
    }
  };

  const handleDelete = async () => {
    if (!deletingConnection) return;
    try {
      await deleteConnection.mutateAsync(deletingConnection.id);
      addNotification({
        type: "delete",
        title: "Connection deleted",
        description: "The connection has been removed.",
        status: "completed",
      });
    } catch (error) {
      addNotification({
        type: "error",
        title: "Error",
        error:
          error instanceof Error ? error.message : "Failed to delete connection",
        status: "error",
      });
    } finally {
      setDeletingConnection(null);
    }
  };

  const getDisplayName = (conn: ConnectionResponse) =>
    conn.name || conn.endpoint;

  return (
    <>
      <aside className="w-64 border-r bg-sidebar-background min-h-screen flex flex-col">
        <div className="p-4 border-b">
          <Link
            href="/buckets"
            className="flex items-center gap-2"
            onClick={handleBucketsClick}
          >
            <Image src="/logo.png" alt="S3 Hub" width={28} height={28} className="shrink-0" />
            <span className="font-semibold text-lg">S3 Hub</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto space-y-1">
          <Link
            href="/buckets"
            onClick={handleBucketsClick}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              isBucketsActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <Database className="h-4 w-4" />
            Buckets
          </Link>

          <Link
            href="/connections"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              isConnectionsActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <Plug className="h-4 w-4" />
            Connections
          </Link>

          {workspaces.length > 0 && (
            <div className="pt-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 pb-1">
                Workspaces
              </p>
              <div className="space-y-0.5">
                {workspaces.map((workspace) => {
                  const isCollapsed = collapsedWorkspaces[workspace.id];
                  const workspaceConns =
                    connectionsByWorkspace[workspace.id] ?? [];
                  return (
                    <div key={workspace.id}>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleWorkspace(workspace.id)}
                          className="flex items-center gap-2 flex-1 px-3 py-1.5 rounded-md text-sm hover:bg-sidebar-accent/50 text-sidebar-foreground min-w-0"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          {workspace.type === "TEAM" ? (
                            <Users className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <Briefcase className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="truncate">{workspace.name}</span>
                        </button>
                        {workspace.role === "ADMIN" && (
                          workspace.type === "TEAM" ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                                  title="Add to team"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  onClick={() => router.push(`/connections?workspaceId=${workspace.id}`)}
                                >
                                  <Plug className="h-3.5 w-3.5" />
                                  Add connection
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => router.push("/teams")}
                                >
                                  <Users className="h-3.5 w-3.5" />
                                  Add member
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Link
                              href={`/connections?workspaceId=${workspace.id}`}
                              title="Add connection"
                              className="p-1 rounded hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Link>
                          )
                        )}
                      </div>

                      {!isCollapsed && workspaceConns.length > 0 && (
                        <ul className="ml-7 mt-0.5 space-y-0.5">
                          {workspaceConns.map((conn) => (
                            <li key={conn.id}>
                              <div className="group flex items-center gap-2 px-3 py-1.5 rounded-md text-xs hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground">
                                <Plug className="h-3 w-3 shrink-0" />
                                <span className="truncate flex-1">
                                  {getDisplayName(conn)}
                                </span>
                                {conn.role === "ADMIN" && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity -mr-1"
                                      >
                                        <MoreHorizontal className="h-3 w-3" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-36">
                                      <DropdownMenuItem
                                        onClick={() => setEditingConnection(conn)}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => setDeletingConnection(conn)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}

                <Link
                  href="/teams"
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors mt-1",
                    isTeamsActive
                      ? "text-sidebar-foreground font-medium"
                      : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New team
                </Link>
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              isSettingsActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      </aside>

      {/* Edit dialog */}
      <Dialog
        open={!!editingConnection}
        onOpenChange={(open) => {
          if (!open) setEditingConnection(null);
        }}
      >
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Edit Connection</DialogTitle>
          </DialogHeader>
          <ConnectionForm
            connection={editingConnection ?? undefined}
            onSuccess={() => setEditingConnection(null)}
            onCancel={() => setEditingConnection(null)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deletingConnection}
        onOpenChange={(open) => {
          if (!open) setDeletingConnection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Connection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;
              {deletingConnection && getDisplayName(deletingConnection)}&quot;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingConnection(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteConnection.isPending}
            >
              {deleteConnection.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
