const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_SEGMENTS = new Set(["meta", "metadata", "_meta"]);

function basenameNoExt(key: string): string {
  const clean = key.endsWith("/") ? key.slice(0, -1) : key;
  const slash = clean.lastIndexOf("/");
  const base = slash === -1 ? clean : clean.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot); // keep dotfiles intact
}

/**
 * Heuristic: a result is "metadata/other" — low signal to a human scanning
 * results — when its basename (sans extension) is a bare UUID, or it lives
 * under a directory segment named meta/metadata/_meta.
 */
export function isLikelyMetadata(key: string): boolean {
  if (UUID_RE.test(basenameNoExt(key))) return true;
  const dirSegments = key.split("/").slice(0, -1);
  return dirSegments.some((s) => META_SEGMENTS.has(s.toLowerCase()));
}
