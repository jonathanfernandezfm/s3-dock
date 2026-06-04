import type { SubscriptionTier } from "@/generated/prisma/client";

export type GatedFeature = "shareLinks" | "teams";

const FEATURE_TIERS: Record<GatedFeature, SubscriptionTier[]> = {
  shareLinks: ["PRO", "ENTERPRISE"],
  teams: ["PRO", "ENTERPRISE"],
};

export function canAccessFeature(
  tier: SubscriptionTier,
  feature: GatedFeature
): boolean {
  return FEATURE_TIERS[feature].includes(tier);
}
