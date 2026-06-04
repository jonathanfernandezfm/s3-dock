"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/keys";
import { TIER_LIMITS, type TierConfig } from "@/lib/subscriptions";
import { canAccessFeature, type GatedFeature } from "@/lib/subscriptions/gates";
import type { SubscriptionTier } from "@/generated/prisma/client";

interface SubscriptionResponse {
  tier: SubscriptionTier;
  limits: TierConfig;
}

export function useTier() {
  const { data } = useQuery<SubscriptionResponse>({
    queryKey: queryKeys.user.subscription(),
    queryFn: async () => {
      const res = await fetch("/api/user/subscription");
      if (!res.ok) throw new Error("Failed to fetch subscription");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const tier: SubscriptionTier = data?.tier ?? "FREE";
  const limits: TierConfig = data?.limits ?? TIER_LIMITS.FREE;

  return {
    tier,
    limits,
    can: (feature: GatedFeature) => canAccessFeature(tier, feature),
  };
}
