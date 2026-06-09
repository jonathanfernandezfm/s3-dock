"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { ChevronDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./primitives/reveal";
import { useLoop } from "./primitives/use-loop";
import { FileGrid, type FileItem } from "./mocks/file-grid";
import { CommandPaletteMock } from "./mocks/command-palette-mock";

const TAB_BUCKETS: Record<string, FileItem[]> = {
  "prod-assets": [
    { name: "logo.svg", kind: "image" },
    { name: "fonts", kind: "folder" },
    { name: "og.png", kind: "image" },
  ],
  "user-uploads": [
    { name: "avatars", kind: "folder" },
    { name: "exports", kind: "folder" },
    { name: "tmp.zip", kind: "archive" },
  ],
  backups: [
    { name: "db-monday.gz", kind: "archive" },
    { name: "db-tuesday.gz", kind: "archive" },
    { name: "snapshots", kind: "folder" },
  ],
};

function Tile({
  title,
  caption,
  className,
  children,
}: {
  title: string;
  caption: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-5 transition-all duration-300",
        "hover:scale-[1.01] hover:border-[var(--accent-amber)]/30 hover:shadow-[0_0_40px_var(--accent-amber-glow)]",
        className
      )}
    >
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mb-4 mt-1 text-sm text-[var(--landing-muted)]">{caption}</p>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function SplitViewTile({ active }: { active: boolean }) {
  return (
    <Tile
      title="Split view"
      caption="Two buckets side by side. Drag files straight across."
      className="md:row-span-2"
    >
      <div className="space-y-3">
        <div className="relative rounded-lg border border-white/10 bg-[#0d0d0d] p-2">
          <p className="mb-1 font-mono text-[10px] text-white/40">prod / images</p>
          <FileGrid
            items={[
              { name: "a.png", kind: "image" },
              { name: "b.png", kind: "image" },
              { name: "c.png", kind: "image" },
            ]}
            className="grid-cols-3 gap-1 p-1"
          />
          <motion.div
            animate={
              active
                ? { x: [0, 0, 0], y: [0, 90, 90], opacity: [1, 1, 0] }
                : { x: 0, y: 0, opacity: 1 }
            }
            transition={
              active ? { duration: 4, repeat: Infinity, times: [0.2, 0.6, 0.8] } : undefined
            }
            className="absolute left-3 top-8 z-10 rounded-md border border-[var(--accent-amber)]/50 bg-[var(--accent-amber)]/20 px-2 py-1 font-mono text-[10px] text-[var(--accent-amber)]"
          >
            hero-final.png
          </motion.div>
        </div>
        <div className="rounded-lg border border-dashed border-[var(--accent-amber)]/40 bg-[#0d0d0d] p-2">
          <p className="mb-1 font-mono text-[10px] text-white/40">staging / images</p>
          <FileGrid
            items={[
              { name: "old.png", kind: "image" },
              { name: "draft.png", kind: "image" },
            ]}
            className="grid-cols-3 gap-1 p-1"
          />
        </div>
      </div>
    </Tile>
  );
}

function TabsTile({ active }: { active: boolean }) {
  const names = Object.keys(TAB_BUCKETS);
  const tab = useLoop(names.length, 2500, active);
  return (
    <Tile
      title="Tabs"
      caption="Every bucket one click away — like browser tabs, for storage."
      className="md:col-span-2"
    >
      <div className="rounded-lg border border-white/10 bg-[#0d0d0d]">
        <div className="flex gap-1 border-b border-white/5 px-2 pt-2">
          {names.map((name, i) => (
            <span
              key={name}
              className={cn(
                "rounded-t-md px-3 py-1.5 font-mono text-[11px] transition-colors duration-300",
                i === tab ? "bg-white/10 text-white/90" : "text-white/35"
              )}
            >
              {name}
            </span>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <FileGrid items={TAB_BUCKETS[names[tab]]} className="grid-cols-3 p-2" />
          </motion.div>
        </AnimatePresence>
      </div>
    </Tile>
  );
}

function SearchTile({ active }: { active: boolean }) {
  return (
    <Tile title="Indexed search" caption="Search file names across every connected bucket, instantly.">
      <CommandPaletteMock
        active={active}
        scenes={[
          { query: "invoice.pdf", results: ["billing/2026/invoice.pdf", "archive/invoice.pdf"] },
          { query: "hero image", results: ["assets/img/hero.png", "marketing/hero-v2.png"] },
          { query: "*.zip", results: ["builds/v1.4.0.zip", "exports/data.zip"] },
        ]}
      />
    </Tile>
  );
}

function VersionsTile({ active }: { active: boolean }) {
  const versions = ["Today 14:32", "Yesterday 09:10", "Jun 2, 18:45"];
  const highlight = useLoop(versions.length, 1800, active);
  return (
    <Tile title="Versions" caption="Every revision of every file, one click to restore.">
      <div className="space-y-1.5 rounded-lg border border-white/10 bg-[#0d0d0d] p-2">
        {versions.map((v, i) => (
          <div
            key={v}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-[11px] transition-colors duration-300",
              i === highlight
                ? "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]"
                : "text-white/40"
            )}
          >
            <Clock className="size-3" />
            report.docx — {v}
          </div>
        ))}
      </div>
    </Tile>
  );
}

function MultiAccountTile({ active }: { active: boolean }) {
  const open = useLoop(2, 2200, active) === 1;
  const connections = [
    ["AWS S3", "us-east-1"],
    ["Cloudflare R2", "auto"],
    ["MinIO", "homelab"],
  ];
  return (
    <Tile
      title="Every account, one place"
      caption="Switch between AWS, R2, MinIO and more without re-logging in."
      className="md:col-span-2"
    >
      <div className="rounded-lg border border-white/10 bg-[#0d0d0d] p-2">
        <div className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2 font-mono text-xs text-white/70">
          AWS S3 · us-east-1
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")}
          />
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              {connections.map(([name, region]) => (
                <div
                  key={name}
                  className="flex justify-between px-3 py-1.5 font-mono text-[11px] text-white/40"
                >
                  {name} <span className="text-white/25">{region}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Tile>
  );
}

function MoreTile() {
  const extras = ["Previews", "File notes", "Activity feed", "Health checks", "Bookmarks", "Share links"];
  return (
    <Tile title="And the rest" caption="Small things that add up.">
      <div className="flex flex-wrap gap-1.5">
        {extras.map((label) => (
          <span
            key={label}
            className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-white/50"
          >
            {label}
          </span>
        ))}
      </div>
    </Tile>
  );
}

export function FeatureBento() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });

  return (
    <section id="features" className="px-6 py-32">
      <Reveal className="mx-auto mb-16 max-w-3xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
          Power tools, zero terminal.
        </h2>
        <p className="mt-4 text-lg text-[var(--landing-muted)]">
          Everything the console makes hard, one click away.
        </p>
      </Reveal>

      <div ref={ref} className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-3">
        <SplitViewTile active={inView} />
        <TabsTile active={inView} />
        <SearchTile active={inView} />
        <VersionsTile active={inView} />
        <MultiAccountTile active={inView} />
        <MoreTile />
      </div>
    </section>
  );
}
