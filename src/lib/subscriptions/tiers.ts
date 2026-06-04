import type { SubscriptionTier } from "@/generated/prisma/client";

export interface TeamLimits {
  readonly enabled: boolean;
  /** Only meaningful when enabled is true. -1 = unlimited, 0 = not applicable */
  readonly maxTeams: number;
  /** Only meaningful when enabled is true. -1 = unlimited, 0 = not applicable */
  readonly maxMembersPerTeam: number;
}

export interface TierConfig {
  readonly maxConnections: number;
  readonly maxUploadSizeMB: number;
  readonly monthlyOperations: number;
  readonly shareLinks: boolean;
  readonly teams: TeamLimits;
  readonly activityRetentionDays: number; // -1 = unlimited
}

export const TIER_LIMITS: Record<SubscriptionTier, TierConfig> = {
  FREE: {
    maxConnections: 2,
    maxUploadSizeMB: 50,
    monthlyOperations: 1000,
    shareLinks: false,
    teams: { enabled: false, maxTeams: 0, maxMembersPerTeam: 0 },
    activityRetentionDays: 30,
  },
  PRO: {
    maxConnections: 10,
    maxUploadSizeMB: -1,
    monthlyOperations: 50000,
    shareLinks: true,
    teams: { enabled: true, maxTeams: 1, maxMembersPerTeam: 5 },
    activityRetentionDays: 90,
  },
  ENTERPRISE: {
    maxConnections: -1,
    maxUploadSizeMB: -1,
    monthlyOperations: -1,
    shareLinks: true,
    teams: { enabled: true, maxTeams: -1, maxMembersPerTeam: -1 },
    activityRetentionDays: -1,
  },
};

/** @deprecated Use TierConfig instead */
export type TierLimits = TierConfig;

export function getTierLimits(tier: SubscriptionTier): TierConfig {
  return TIER_LIMITS[tier];
}

export function isUnlimited(limit: number): boolean {
  return limit === -1;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function getTierDisplayName(tier: SubscriptionTier): string {
  const names: Record<SubscriptionTier, string> = {
    FREE: "Free",
    PRO: "Pro",
    ENTERPRISE: "Enterprise",
  };
  return names[tier];
}
