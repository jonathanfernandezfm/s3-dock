export interface ObjectStatsAccumulator {
  count: number;
  size: number;
  byClass: Map<string, { count: number; size: number }>;
}

export interface StorageClassSummary {
  class: string;
  count: number;
  size: number;
}

export function emptyAccumulator(): ObjectStatsAccumulator {
  return { count: 0, size: 0, byClass: new Map() };
}

export function accumulateObjectStats(
  acc: ObjectStatsAccumulator,
  contents: Array<{ Size?: number; StorageClass?: string }>,
): ObjectStatsAccumulator {
  for (const entry of contents) {
    const size = entry.Size ?? 0;
    const cls = entry.StorageClass ?? "STANDARD";
    acc.count += 1;
    acc.size += size;
    const prior = acc.byClass.get(cls);
    if (prior) {
      prior.count += 1;
      prior.size += size;
    } else {
      acc.byClass.set(cls, { count: 1, size });
    }
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
