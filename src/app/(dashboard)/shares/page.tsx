"use client";
import { Suspense, useMemo } from "react";
import { Briefcase, Loader2, Plug, Users } from "lucide-react";
import { useConnections, type ConnectionResponse } from "@/lib/queries/connections";
import { useWorkspaces, type WorkspaceSummary } from "@/lib/queries/workspaces";
import { ShareListTable } from "@/components/shares/share-list-table";
import { useTier } from "@/hooks/use-tier";
import { LockedPageOverlay } from "@/components/billing/locked-page-overlay";

function SharesContent() {
  const { can } = useTier();
  const { data: connections = [], isLoading: isLoadingConns } = useConnections();
  const { data: workspaces = [], isLoading: isLoadingWs } = useWorkspaces();

  if (!can("shareLinks")) {
    return (
      <LockedPageOverlay
        feature="Share Links"
        description="Generate secure, shareable links for any file in your buckets — with optional password protection, expiration dates, and usage analytics."
      />
    );
  }

  const workspaceGroups = useMemo(() => {
    const wsMap = new Map<
      string,
      { workspace: WorkspaceSummary; connections: ConnectionResponse[] }
    >();
    for (const ws of workspaces) wsMap.set(ws.id, { workspace: ws, connections: [] });
    for (const conn of connections) wsMap.get(conn.workspaceId)?.connections.push(conn);
    return Array.from(wsMap.values()).filter((g) => g.connections.length > 0);
  }, [workspaces, connections]);

  return (
    <div className="space-y-6 flex-1 p-6 overflow-auto">
      <div>
        <h1 className="text-2xl font-bold">Shares</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage share links across your connections.
        </p>
      </div>

      {isLoadingConns || isLoadingWs ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : workspaceGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No connections found.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {workspaceGroups.map(({ workspace, connections: wsConns }) => (
            <div key={workspace.id} className="space-y-6">
              <div className="flex items-center gap-2 border-b pb-2">
                {workspace.type === "TEAM" ? (
                  <Users className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Briefcase className="h-5 w-5 text-muted-foreground" />
                )}
                <h2 className="text-lg font-semibold">{workspace.name}</h2>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5">
                  {workspace.role}
                </span>
              </div>

              <div className="space-y-8">
                {wsConns.map((conn) => (
                  <div key={conn.id} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Plug className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium">{conn.name ?? conn.endpoint}</h3>
                      {conn.name && (
                        <span className="text-xs text-muted-foreground">{conn.endpoint}</span>
                      )}
                    </div>
                    <ShareListTable connectionId={conn.id} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SharesPage() {
  return (
    <Suspense>
      <SharesContent />
    </Suspense>
  );
}
