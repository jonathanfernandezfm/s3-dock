// src/lib/health/mutex.ts
const inflight = new Map<string, Promise<unknown>>();

export async function withMutex<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

// For tests only — clear all in-flight entries.
export function __resetMutex(): void {
  inflight.clear();
}
