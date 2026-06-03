"use client";

import { UserButton } from "@clerk/nextjs";
import { Search } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { usePaletteIntentStore } from "@/lib/stores/palette-intent-store";

export function Header() {
  const openPalette = usePaletteIntentStore((s) => s.openPalette);

  return (
    <header className="h-14 border-b bg-background flex items-center justify-between px-6">
      <button
        type="button"
        onClick={openPalette}
        className="flex items-center gap-2 h-9 w-72 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Search or run a command...</span>
        <kbd className="hidden sm:flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
          <span className="text-[10px]">⌘</span>K
        </kbd>
      </button>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserButton
          afterSignOutUrl="/sign-in"
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
      </div>
    </header>
  );
}
