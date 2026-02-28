"use client";

import { useTransferStore, TransferBatch } from "@/lib/stores/transfer-store";
import { X, Check, AlertCircle, Loader2, Copy, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function TransferBatchItem({ batch }: { batch: TransferBatch }) {
  const { removeBatch } = useTransferStore();

  const totalCount = batch.items.length;

  const Icon = batch.operation === "copy" ? Copy : Move;
  const operationLabel = batch.operation === "copy" ? "Copying" : "Moving";
  const pastLabel = batch.operation === "copy" ? "Copied" : "Moved";

  return (
    <div className="flex items-start gap-3 p-3 bg-card border rounded-lg shadow-sm">
      <div className="mt-0.5">
        {batch.status === "in-progress" ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        ) : batch.status === "completed" ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-3.5 w-3.5" />
          <span>
            {batch.status === "in-progress"
              ? `${operationLabel} ${totalCount} item${totalCount !== 1 ? "s" : ""}`
              : batch.status === "completed"
              ? `${pastLabel} ${totalCount} item${totalCount !== 1 ? "s" : ""}`
              : `Failed to ${batch.operation}`}
          </span>
        </div>

        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {batch.sourceBucket} → {batch.targetBucket}
        </div>

        {batch.status === "in-progress" && (
          <div className="mt-2">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300 animate-pulse"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}

        {batch.status === "error" && batch.error && (
          <div className="text-sm text-destructive mt-1.5 wrap-break-word" title={batch.error}>
            {batch.error}
          </div>
        )}
      </div>

      {batch.status !== "in-progress" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => removeBatch(batch.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function TransferProgress() {
  const batches = useTransferStore((state) => state.batches);
  const clearCompletedBatches = useTransferStore((state) => state.clearCompletedBatches);

  if (batches.length === 0) return null;

  const hasCompleted = batches.some((b) => b.status !== "in-progress");

  return (
    <div className="fixed bottom-4 left-4 z-50 w-96 space-y-2">
      {hasCompleted && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={clearCompletedBatches}
          >
            Clear completed
          </Button>
        </div>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {batches.map((batch) => (
          <TransferBatchItem key={batch.id} batch={batch} />
        ))}
      </div>
    </div>
  );
}
