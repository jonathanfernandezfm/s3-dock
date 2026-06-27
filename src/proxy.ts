import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk(.*)",
  "/api/internal/(.*)",
  "/s(.*)",
  "/opengraph-image(.*)",
]);

const clerkProxy = clerkMiddleware(async (auth, req) => {
  // Landing page: public for visitors, but signed-in users go straight to the app
  if (req.nextUrl.pathname === "/") {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL("/app/buckets", req.url));
    }
    return;
  }

  // Legacy dashboard URLs moved under /app — keep old bookmarks working
  const legacyPrefix = /^\/(buckets|connections|shares|teams|settings|browser)(\/.*)?$/;
  if (legacyPrefix.test(req.nextUrl.pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = `/app${url.pathname}`;
    return NextResponse.redirect(url, 308);
  }

  // Protect all routes except public ones
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export function proxy(request: NextRequest) {
  return clerkProxy(request, {} as never);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
