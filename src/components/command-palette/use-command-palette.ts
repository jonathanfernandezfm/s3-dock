"use client";

import { useCallback, useEffect } from "react";
import { usePaletteIntentStore } from "@/lib/stores/palette-intent-store";

export function useCommandPalette() {
  const open = usePaletteIntentStore((s) => s.open);
  const openPalette = usePaletteIntentStore((s) => s.openPalette);
  const closePalette = usePaletteIntentStore((s) => s.closePalette);
  const togglePalette = usePaletteIntentStore((s) => s.togglePalette);

  const setOpen = useCallback(
    (next: boolean) => (next ? openPalette() : closePalette()),
    [openPalette, closePalette]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePalette]);

  return { open, setOpen };
}
