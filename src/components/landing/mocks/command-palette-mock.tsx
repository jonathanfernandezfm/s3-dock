"use client";

import { useEffect, useState } from "react";
import { FileText, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaletteScene {
  query: string;
  results: string[];
}

interface CommandPaletteMockProps {
  scenes: PaletteScene[];
  /** Pause typing when false (e.g. off-screen). */
  active?: boolean;
  className?: string;
}

/** ⌘K palette with a looping typewriter query and filtered results. */
export function CommandPaletteMock({
  scenes,
  active = true,
  className,
}: CommandPaletteMockProps) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [chars, setChars] = useState(0);
  const scene = scenes[sceneIndex];
  const done = chars >= scene.query.length;

  // type the query one character at a time
  useEffect(() => {
    if (!active || done) return;
    const id = setInterval(() => setChars((c) => c + 1), 70);
    return () => clearInterval(id);
  }, [active, done]);

  // hold the finished query, then advance to the next scene
  useEffect(() => {
    if (!active || !done) return;
    const id = setTimeout(() => {
      setSceneIndex((i) => (i + 1) % scenes.length);
      setChars(0);
    }, 1800);
    return () => clearTimeout(id);
  }, [active, done, scenes.length]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-white/10 bg-[#101010] shadow-2xl",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <Search className="size-4 shrink-0 text-white/30" />
        <span className="font-mono text-sm text-white/80">
          {scene.query.slice(0, chars)}
          <span className="animate-pulse text-[var(--accent-amber)]">▏</span>
        </span>
        <kbd className="ml-auto rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/40">
          ⌘K
        </kbd>
      </div>
      <div className="p-2">
        {scene.results.map((result, i) => (
          <div
            key={result}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs text-white/50 transition-opacity duration-300",
              !done && "opacity-0",
              done && i === 0 && "bg-[var(--accent-amber)]/10 text-white/80"
            )}
          >
            <FileText className="size-3.5 shrink-0 text-white/30" />
            {result}
          </div>
        ))}
      </div>
    </div>
  );
}
