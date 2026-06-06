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
