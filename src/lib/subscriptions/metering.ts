import type { SubscriptionTier } from "@/generated/prisma/client";
import { canPerformOperation, type LimitCheckResult } from "./check-limits";
import { recordOperation } from "./usage";

/**
 * Check the monthly operation quota and, when allowed, record one operation.
 * Operations are counted per S3 API call (list, copy, move, rename, delete,
 * tag, folder create, upload, download) per the subscription-tiers spec.
 */
export async function meterOperation(
  userId: string,
  tier: SubscriptionTier
): Promise<LimitCheckResult> {
  const check = await canPerformOperation(userId, tier);
  if (!check.allowed) {
    return check;
  }
  await recordOperation(userId);
  return check;
}
