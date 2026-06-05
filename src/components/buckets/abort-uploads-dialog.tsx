"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface AbortUploadsDialogProps {
  open: boolean;
  count: number;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AbortUploadsDialog({
  open,
  count,
  isPending,
  onConfirm,
  onCancel,
}: AbortUploadsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Abort {count} incomplete upload{count === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription>
            This permanently deletes the partial data stored in S3. If an upload
            is still in progress somewhere, it will fail. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Abort
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
