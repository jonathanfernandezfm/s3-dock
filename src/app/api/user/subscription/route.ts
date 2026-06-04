import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getTierLimits } from "@/lib/subscriptions";

export const GET = withAuth(async (_req, { user }) => {
  const tier = user.subscription?.tier ?? "FREE";
  const limits = getTierLimits(tier);
  return NextResponse.json({ tier, limits });
});
