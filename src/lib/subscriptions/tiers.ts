import type { SubscriptionTier } from "@/generated/prisma/client";

export const TIER_LIMITS = {
  FREE: {
    maxConnections: 2, // Max S3 connections
    maxUploadSizeMB: 50, // Max single file upload (MB)
    monthlyUploadGB: 5, // Max monthly upload volume (GB)
    monthlyDownloadGB: 10, // Max monthly download volume (GB)
    monthlyOperations: 1000, // Max API operations per month
  },
  PRO: {
    maxConnections: 10,
    maxUploadSizeMB: 500, // 500MB single file
    monthlyUploadGB: 100, // 100GB monthly upload
    monthlyDownloadGB: 500, // 500GB monthly download
    monthlyOperations: 50000,
  },
  ENTERPRISE: {
    maxConnections: -1, // Unlimited (-1)
    maxUploadSizeMB: -1, // Unlimited
    monthlyUploadGB: -1, // Unlimited
    monthlyDownloadGB: -1, // Unlimited
    monthlyOperations: -1, // Unlimited
  },
} as const;

export type TierLimits = (typeof TIER_LIMITS)[SubscriptionTier];

/**
 * Get tier limits for a subscription tier
 */
export function getTierLimits(tier: SubscriptionTier): TierLimits {
  return TIER_LIMITS[tier];
}

/**
 * Check if a limit is unlimited
 */
export function isUnlimited(limit: number): boolean {
  return limit === -1;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: SubscriptionTier): string {
  const names: Record<SubscriptionTier, string> = {
    FREE: "Free",
    PRO: "Pro",
    ENTERPRISE: "Enterprise",
  };
  return names[tier];
}
