"use client";

import { CommandPalette } from "./command-palette";
import { useCommandPalette } from "./use-command-palette";

export function CommandPaletteMount() {
  const { open, setOpen } = useCommandPalette();
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}
