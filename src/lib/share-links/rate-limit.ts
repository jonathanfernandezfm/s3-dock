import { LRUCache } from "lru-cache";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000;

let cache = new LRUCache<string, number>({ max: 10000, ttl: WINDOW_MS });

function key(ip: string, slug: string): string {
  return `${ip}:${slug}`;
}

export function checkUnlockRateLimit(ip: string, slug: string): boolean {
  const k = key(ip, slug);
  const count = cache.get(k) ?? 0;
  if (count >= MAX_ATTEMPTS) return false;
  cache.set(k, count + 1);
  return true;
}

export function resetUnlockRateLimit(): void {
  cache = new LRUCache<string, number>({ max: 10000, ttl: WINDOW_MS });
}
