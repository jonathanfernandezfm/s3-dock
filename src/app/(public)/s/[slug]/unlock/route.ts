import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  getShareLinkBySlug,
  recordShareLinkEvent,
} from "@/lib/db/share-links";
import { verifyPassword } from "@/lib/share-links/password";
import {
  signUnlockCookie,
  cookieNameForSlug,
  COOKIE_TTL_SECONDS,
} from "@/lib/share-links/cookie";
import { checkUnlockRateLimit } from "@/lib/share-links/rate-limit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const form = await req.formData();
  const password = (form.get("password") ?? "").toString();
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const redirectTo = new URL(`/s/${slug}`, `${proto}://${host}`);

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (!checkUnlockRateLimit(ip, slug)) {
    redirectTo.searchParams.set("error", "rate-limited");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  const link = await getShareLinkBySlug(slug);
  if (!link || !link.passwordHash) {
    redirectTo.searchParams.set("error", "invalid");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "UNLOCK_ATTEMPT",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
    referrer: null,
  });

  const ok = await verifyPassword(password, link.passwordHash);
  if (!ok) {
    redirectTo.searchParams.set("error", "invalid");
    return NextResponse.redirect(redirectTo, { status: 303 });
  }

  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "UNLOCK_SUCCESS",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
    referrer: null,
  });

  const token = await signUnlockCookie(slug);
  const response = NextResponse.redirect(redirectTo, { status: 303 });
  response.cookies.set(cookieNameForSlug(slug), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/s/${slug}`,
    maxAge: COOKIE_TTL_SECONDS,
  });
  return response;
}
