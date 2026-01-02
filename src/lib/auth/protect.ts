import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/db/prisma";
import type { AuthUser } from "./clerk";

type RouteContext = {
  params?: Promise<Record<string, string>>;
};

type ProtectedHandler<T extends RouteContext = RouteContext> = (
  req: NextRequest,
  context: { user: AuthUser; params: T["params"] extends Promise<infer P> ? P : Record<string, string> }
) => Promise<NextResponse>;

/**
 * Wrapper for API routes that require authentication
 * Automatically fetches user and passes to handler
 */
export function withAuth<T extends RouteContext = RouteContext>(
  handler: ProtectedHandler<T>
) {
  return async (req: NextRequest, context?: T) => {
    try {
      const { userId } = await auth();

      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
        include: { subscription: true },
      });

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const params = context?.params ? await context.params : {};

      return handler(req, { user, params: params as T["params"] extends Promise<infer P> ? P : Record<string, string> });
    } catch (error) {
      console.error("Auth error:", error);
      return NextResponse.json(
        { error: "Authentication failed" },
        { status: 500 }
      );
    }
  };
}
