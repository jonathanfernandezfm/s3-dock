import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client } from "@/lib/s3/client";
import { decrypt } from "@/lib/crypto";
import {
  getShareLinkBySlug,
  atomicIncrementUseCount,
  recordShareLinkEvent,
} from "@/lib/db/share-links";
import {
  verifyUnlockCookie,
  cookieNameForSlug,
} from "@/lib/share-links/cookie";

const DOWNLOAD_URL_TTL_SECONDS = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const link = await getShareLinkBySlug(slug);
  if (!link) {
    return new NextResponse("Link not found", { status: 404 });
  }

  if (link.passwordHash) {
    const c = await cookies();
    const cookieVal = c.get(cookieNameForSlug(slug))?.value;
    const ok = cookieVal ? (await verifyUnlockCookie(cookieVal)) === slug : false;
    if (!ok) {
      return new NextResponse("Password required", { status: 401 });
    }
  }

  const claimed = await atomicIncrementUseCount(link.id);
  if (!claimed) {
    return new NextResponse("Link no longer available", { status: 410 });
  }

  const h = await headers();
  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "DOWNLOAD",
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
    referrer: h.get("referer") ?? null,
  });

  const client = createS3Client({
    ...link.connection,
    secretAccessKey: decrypt(link.connection.secretAccessKey),
  });
  const command = new GetObjectCommand({
    Bucket: link.bucket,
    Key: link.key,
  });
  const signedUrl = await getSignedUrl(client, command, {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  });

  return NextResponse.redirect(signedUrl, { status: 302 });
}
