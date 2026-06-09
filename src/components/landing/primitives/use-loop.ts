"use client";

import { useEffect, useState } from "react";

/**
 * Cycles 0..steps-1 on an interval while enabled. Drives looping demo mocks.
 * Pass enabled=false (e.g. from useInView) to pause off-screen and save CPU.
 */
export function useLoop(steps: number, intervalMs: number, enabled = true): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!enabled || steps <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % steps);
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, steps, intervalMs]);

  return index;
}
