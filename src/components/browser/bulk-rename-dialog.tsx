"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyRenamePattern,
  type RenamePattern,
  type RenamePreviewItem,
} from "@/lib/bulk-rename";
import type { S3Object } from "@/types";

interface BulkRenameDialogProps {
  open: boolean;
  onClose: () => void;
  selection: S3Object[];
  onApply: (items: RenamePreviewItem[]) => void;
}

type PatternKind = RenamePattern["kind"];

export function BulkRenameDialog({
  open,
  onClose,
  selection,
  onApply,
}: BulkRenameDialogProps) {
  const [kind, setKind] = useState<PatternKind>("find-replace");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [baseName, setBaseName] = useState("file-");
  const [startAt, setStartAt] = useState(1);
  const [padTo, setPadTo] = useState(3);

  const fileSelection = useMemo(
    () => selection.filter((o) => !o.isFolder),
    [selection]
  );
  const folderCount = selection.length - fileSelection.length;

  const pattern: RenamePattern = useMemo(() => {
    switch (kind) {
      case "find-replace":
        return { kind: "find-replace", find, replace, matchCase };
      case "prefix":
        return { kind: "prefix", text: prefix };
      case "suffix":
        return { kind: "suffix", text: suffix };
      case "sequence":
        return { kind: "sequence", baseName, startAt, padTo };
    }
  }, [kind, find, replace, matchCase, prefix, suffix, baseName, startAt, padTo]);

  const preview = useMemo(
    () => applyRenamePattern(fileSelection.map((o) => o.key), pattern),
    [fileSelection, pattern]
  );

  const changedCount = preview.filter((p) => p.changed).length;
  const hasDuplicates = useMemo(() => {
    const seen = new Set<string>();
    for (const p of preview) {
      if (seen.has(p.newKey)) return true;
      seen.add(p.newKey);
    }
    return false;
  }, [preview]);

  const canApply = changedCount > 0 && !hasDuplicates;

  const handleApply = () => {
    onApply(preview.filter((p) => p.changed));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Rename {fileSelection.length} item{fileSelection.length !== 1 ? "s" : ""}</DialogTitle>
          <DialogDescription>
            Apply a pattern transform. Folders cannot be bulk-renamed and are skipped.
            {folderCount > 0 && ` (${folderCount} folder${folderCount !== 1 ? "s" : ""} excluded)`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0">
          <div className="flex gap-2">
            {(["find-replace", "prefix", "suffix", "sequence"] as PatternKind[]).map((k) => (
              <Button
                key={k}
                type="button"
                variant={kind === k ? "default" : "outline"}
                size="sm"
                onClick={() => setKind(k)}
              >
                {k === "find-replace" ? "Find / Replace" : k.charAt(0).toUpperCase() + k.slice(1)}
              </Button>
            ))}
          </div>

          {kind === "find-replace" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="find">Find</Label>
                <Input id="find" value={find} onChange={(e) => setFind(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="replace">Replace with</Label>
                <Input id="replace" value={replace} onChange={(e) => setReplace(e.target.value)} />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={matchCase}
                  onChange={(e) => setMatchCase(e.target.checked)}
                />
                Match case
              </label>
            </div>
          )}

          {kind === "prefix" && (
            <div>
              <Label htmlFor="prefix">Prefix</Label>
              <Input id="prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </div>
          )}

          {kind === "suffix" && (
            <div>
              <Label htmlFor="suffix">Suffix (before extension)</Label>
              <Input id="suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
            </div>
          )}

          {kind === "sequence" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <Label htmlFor="base">Base name</Label>
                <Input id="base" value={baseName} onChange={(e) => setBaseName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="start">Start at</Label>
                <Input
                  id="start"
                  type="number"
                  value={startAt}
                  onChange={(e) => setStartAt(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label htmlFor="pad">Pad to</Label>
                <Input
                  id="pad"
                  type="number"
                  min={0}
                  value={padTo}
                  onChange={(e) => setPadTo(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
            </div>
          )}

          <div className="border rounded-md max-h-64 overflow-auto text-xs font-mono">
            {preview.length === 0 ? (
              <div className="p-3 text-muted-foreground">No files selected.</div>
            ) : (
              preview.map((p) => (
                <div
                  key={p.oldKey}
                  className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 min-w-max ${
                    p.changed ? "" : "text-muted-foreground"
                  }`}
                >
                  <span title={p.oldKey}>{filename(p.oldKey)}</span>
                  <span>→</span>
                  <span title={p.newKey}>{filename(p.newKey)}</span>
                </div>
              ))
            )}
          </div>

          {hasDuplicates && (
            <p className="text-sm text-destructive">
              Pattern produces duplicate names. Adjust before applying.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleApply} disabled={!canApply}>
            Rename {changedCount} item{changedCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function filename(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const slash = trimmed.lastIndexOf("/");
  return (slash === -1 ? trimmed : trimmed.slice(slash + 1)) + (key.endsWith("/") ? "/" : "");
}
