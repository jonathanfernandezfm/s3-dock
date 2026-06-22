export interface ObjectStatsAccumulator {
  count: number;
  size: number;
  byClass: Map<string, { count: number; size: number }>;
  byExtension: Map<string, { count: number; size: number }>;
  largest: Array<{ key: string; size: number }>; // sorted size desc, capped at LARGEST_N
}

export interface StorageClassSummary {
  class: string;
  count: number;
  size: number;
}

export interface ExtensionSummary {
  ext: string;
  count: number;
  size: number;
}

export const LARGEST_N = 10;

export function emptyAccumulator(): ObjectStatsAccumulator {
  return { count: 0, size: 0, byClass: new Map(), byExtension: new Map(), largest: [] };
}

/** lowercased extension without the dot, or "(none)" for extensionless / dotfiles / folder markers. */
export function extensionOf(key: string): string {
  const slash = key.lastIndexOf("/");
  const name = slash === -1 ? key : key.slice(slash + 1);
  if (name === "") return "(none)"; // folder placeholder key ending in "/"
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "(none)";
  return name.slice(dot + 1).toLowerCase();
}

function trackLargest(
  largest: Array<{ key: string; size: number }>,
  key: string,
  size: number,
): void {
  if (largest.length < LARGEST_N) {
    largest.push({ key, size });
    largest.sort((a, b) => b.size - a.size);
  } else if (size > largest[largest.length - 1].size) {
    largest[largest.length - 1] = { key, size };
    largest.sort((a, b) => b.size - a.size);
  }
}

export function accumulateObjectStats(
  acc: ObjectStatsAccumulator,
  contents: Array<{ Key?: string; Size?: number; StorageClass?: string }>,
): ObjectStatsAccumulator {
  for (const entry of contents) {
    const size = entry.Size ?? 0;
    const cls = entry.StorageClass ?? "STANDARD";
    acc.count += 1;
    acc.size += size;

    const priorClass = acc.byClass.get(cls);
    if (priorClass) {
      priorClass.count += 1;
      priorClass.size += size;
    } else {
      acc.byClass.set(cls, { count: 1, size });
    }

    const ext = entry.Key ? extensionOf(entry.Key) : "(none)";
    const priorExt = acc.byExtension.get(ext);
    if (priorExt) {
      priorExt.count += 1;
      priorExt.size += size;
    } else {
      acc.byExtension.set(ext, { count: 1, size });
    }

    if (entry.Key) trackLargest(acc.largest, entry.Key, size);
  }
  return acc;
}

export function summarizeStorageClasses(
  byClass: Map<string, { count: number; size: number }>,
): StorageClassSummary[] {
  return Array.from(byClass.entries())
    .map(([cls, v]) => ({ class: cls, count: v.count, size: v.size }))
    .sort((a, b) => b.size - a.size);
}

export function summarizeExtensions(
  byExtension: Map<string, { count: number; size: number }>,
): ExtensionSummary[] {
  return Array.from(byExtension.entries())
    .map(([ext, v]) => ({ ext, count: v.count, size: v.size }))
    .sort((a, b) => b.size - a.size);
}
