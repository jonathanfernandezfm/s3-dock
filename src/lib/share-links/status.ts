export type ShareLinkStatus = "active" | "expired" | "exhausted" | "revoked";

export type StatusInputs = {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
};

export function computeStatus(link: StatusInputs, now: Date): ShareLinkStatus {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && link.expiresAt <= now) return "expired";
  if (link.maxUses !== null && link.useCount >= link.maxUses) return "exhausted";
  return "active";
}
