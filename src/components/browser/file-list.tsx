"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileRow } from "./file-row";
import { useBrowserStore } from "@/lib/stores/browser-store";
import { usePaneSelection } from "./use-pane-selection";
import { usePaneKeyboard } from "./use-pane-keyboard";
import { cn } from "@/lib/utils";
import type { S3Object } from "@/types";

// Estimated row height in px — matches the actual TableRow height (h-10 = 40px + 2*p-2 padding = ~48px total).
// Adjust if the design changes row density.
const ROW_HEIGHT = 48;

interface FileListProps {
  objects: S3Object[];
  connectionId: string;
  bucket: string;
  currentPath: string;
  canWrite?: boolean;
  isLoading?: boolean;
  onDelete: (key: string) => void;
  onPreview: (object: S3Object) => void;
  onDownload: (key: string) => void;
  onNavigate?: (path: string) => void;
  paneId: string;
  // Drag and drop props
  onDrop?: (
    data: {
      sourcePaneId: string;
      connectionId: string;
      bucket: string;
      path: string;
      items: S3Object[];
    },
    operation: "copy" | "move",
    targetFolder?: string
  ) => void;
  isDragging?: boolean;
  isValidDropTarget?: boolean;
  onDragStart?: (items: S3Object[]) => void;
  onDragEnd?: () => void;
  folderNoteCounts?: Record<string, number>;
  fileShareCounts?: Record<string, number>;
  fileTags?: Record<string, string[]>;
  activeTag?: string | null;
  onTagClick?: (tag: string) => void;
}

export function FileList({
  objects,
  connectionId,
  bucket,
  currentPath,
  canWrite = true,
  isLoading,
  onDelete,
  onPreview,
  onDownload,
  onNavigate,
  paneId,
  onDrop,
  isDragging,
  isValidDropTarget,
  onDragStart,
  onDragEnd,
  folderNoteCounts = {},
  fileShareCounts = {},
  fileTags = {},
  activeTag,
  onTagClick,
}: FileListProps) {
  const getPaneState = useBrowserStore((s) => s.getPaneState);

  const paneState = getPaneState(paneId);
  const selectedItems = paneState.selectedItems;
  const [isListDragOver, setIsListDragOver] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const orderedKeys = useMemo(() => objects.map((o) => o.key), [objects]);
  const { handleSelect, selectAllInPane, clearSelectionInPane } =
    usePaneSelection(paneId, orderedKeys);
  usePaneKeyboard({
    containerRef,
    onSelectAll: selectAllInPane,
    onClearSelection: clearSelectionInPane,
  });

  const rowVirtualizer = useVirtualizer({
    count: objects.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const allSelected =
    objects.length > 0 && objects.every((o) => selectedItems.has(o.key));

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelectionInPane();
    } else {
      selectAllInPane();
    }
  };

  // Drop zone handlers
  const handleDragOver = (e: React.DragEvent) => {
    if (!isValidDropTarget || !canWrite) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.shiftKey ? "move" : "copy";
    setIsListDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only set drag over to false if leaving the container entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsListDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsListDragOver(false);

    if (!isValidDropTarget || !canWrite) return;

    try {
      const data = JSON.parse(e.dataTransfer.getData("application/x-s3-objects"));
      const operation = e.shiftKey ? "move" : "copy";
      onDrop?.(data, operation);
    } catch {
      // Invalid drag data
    }
  };

  const handleFolderDrop = (targetFolderKey: string, operation: "copy" | "move") => {
    if (!canWrite) return;
    // Get the drag data from the store since we can't access dataTransfer here
    const dragState = useBrowserStore.getState().dragState;
    if (!dragState.isDragging) return;

    onDrop?.(
      {
        sourcePaneId: dragState.sourcePaneId!,
        connectionId: dragState.sourceConnectionId!,
        bucket: dragState.sourceBucket!,
        path: dragState.sourcePath,
        items: dragState.draggedItems,
      },
      operation,
      targetFolderKey
    );
  };

  if (objects.length === 0 && !isLoading) {
    return (
      <div
        ref={containerRef}
        tabIndex={0}
        className={cn(
          "flex flex-col items-center justify-center flex-1 min-h-[200px] py-12 text-center transition-colors outline-none",
          isListDragOver && isValidDropTarget && "bg-blue-50 dark:bg-blue-950"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="text-muted-foreground">
          {isListDragOver && isValidDropTarget
            ? "Drop files here"
            : "This folder is empty"}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={cn(
        "flex flex-col flex-1 min-h-[200px] transition-colors outline-none",
        isListDragOver && isValidDropTarget && "ring-2 ring-blue-500 ring-inset bg-blue-50/50 dark:bg-blue-950/50"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header table — fixed column widths that match the virtualized rows below */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleSelectAll}
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-32">Size</TableHead>
            <TableHead className="w-40">Modified</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
      </Table>

      {/* Virtualized body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto"
        style={{ position: "relative" }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const object = objects[virtualRow.index];
            return (
              <div
                key={object.key}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                }}
              >
                <table className="w-full table-fixed text-sm">
                  <tbody>
                    <FileRow
                      object={object}
                      connectionId={connectionId}
                      bucket={bucket}
                      currentPath={currentPath}
                      canWrite={canWrite}
                      isSelected={selectedItems.has(object.key)}
                      onSelect={handleSelect}
                      onDelete={onDelete}
                      onPreview={onPreview}
                      onDownload={onDownload}
                      onNavigate={onNavigate}
                      paneId={paneId}
                      allObjects={objects}
                      selectedItems={selectedItems}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onFolderDrop={handleFolderDrop}
                      isDragging={isDragging}
                      canDropOnFolder={isValidDropTarget && canWrite}
                      noteCount={object.isFolder ? (folderNoteCounts[object.key] ?? 0) : 0}
                      shareCount={!object.isFolder ? (fileShareCounts[object.key] ?? 0) : 0}
                      tags={!object.isFolder ? (fileTags[object.key] ?? []) : []}
                      activeTag={activeTag}
                      onTagClick={onTagClick}
                    />
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>

      {/* Extended drop zone below the rows */}
      {isListDragOver && isValidDropTarget && (
        <div className="flex-1 flex items-center justify-center text-sm text-blue-600 dark:text-blue-400">
          Drop here to add to this folder
        </div>
      )}
    </div>
  );
}
