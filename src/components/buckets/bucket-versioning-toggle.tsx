"use client";

import { useBucketVersioning, useSetBucketVersioning } from "@/lib/queries/buckets";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, ChevronDown } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function BucketVersioningToggle({
  connectionId,
  bucket,
  canEdit,
}: {
  connectionId: string;
  bucket: string;
  canEdit: boolean;
}) {
  const versioning = useBucketVersioning(connectionId, bucket);
  const setVersioning = useSetBucketVersioning(connectionId, bucket);

  const status = versioning.data?.status ?? "Disabled";
  const label =
    status === "Enabled" ? "Versioning: On" : status === "Suspended" ? "Versioning: Suspended" : "Versioning: Off";

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" /> {label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <History className="h-3.5 w-3.5 mr-1" />
          {label}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={status === "Enabled" || setVersioning.isPending}
          onClick={() =>
            setVersioning.mutate(true, {
              onSuccess: () => toast({ title: "Versioning enabled." }),
              onError: (e) => toast({ title: "Failed to enable", description: (e as Error).message }),
            })
          }
        >
          Enable
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={status !== "Enabled" || setVersioning.isPending}
          onClick={() =>
            setVersioning.mutate(false, {
              onSuccess: () => toast({ title: "Versioning suspended." }),
              onError: (e) => toast({ title: "Failed to suspend", description: (e as Error).message }),
            })
          }
        >
          Suspend
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
