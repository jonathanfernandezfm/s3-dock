import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/db/prisma";
import type { User, Subscription } from "@/generated/prisma/client";

export type AuthUser = User & {
  subscription: Subscription | null;
};

/**
 * Get the current authenticated user from the database
 * Returns null if not authenticated
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    include: { subscription: true },
  });

  return user;
}

/**
 * Get the current user or throw if not authenticated
 * Use in API routes and server components that require auth
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return user;
}

/**
 * Get user's subscription tier
 */
export async function getUserTier(
  userId: string
): Promise<"FREE" | "PRO" | "ENTERPRISE"> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  return subscription?.tier ?? "FREE";
}
