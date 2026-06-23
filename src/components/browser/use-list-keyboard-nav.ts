"use client";

import { useEffect } from "react";
import type { S3Object } from "@/types";

export function useListKeyboardNav({
  containerRef,
  objects,
  focusedIndex,
  setFocusedIndex,
  onActivate,
  onDeleteFocused,
  canWrite,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  objects: S3Object[];
  focusedIndex: number;
  setFocusedIndex: (updater: number | ((prev: number) => number)) => void;
  onActivate: (object: S3Object) => void;
  onDeleteFocused: (object: S3Object) => void;
  canWrite: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const active = document.activeElement;
      const inEditable =
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);
      if (inEditable) return;
      const focusInside =
        active === container ||
        (active instanceof Node && container.contains(active));
      if (!focusInside) return;
      if (objects.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          Math.min((prev < 0 ? -1 : prev) + 1, objects.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max((prev < 0 ? 0 : prev) - 1, 0));
      } else if (e.key === "Enter") {
        if (focusedIndex >= 0 && focusedIndex < objects.length) {
          e.preventDefault();
          onActivate(objects[focusedIndex]);
        }
      } else if (e.key === "Delete") {
        if (
          canWrite &&
          focusedIndex >= 0 &&
          focusedIndex < objects.length
        ) {
          e.preventDefault();
          onDeleteFocused(objects[focusedIndex]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    containerRef,
    objects,
    focusedIndex,
    setFocusedIndex,
    onActivate,
    onDeleteFocused,
    canWrite,
  ]);
}
