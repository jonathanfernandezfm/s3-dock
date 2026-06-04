import { headers, cookies } from "next/headers";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client } from "@/lib/s3/client";
import { decrypt } from "@/lib/crypto";
import { getShareLinkBySlug, recordShareLinkEvent } from "@/lib/db/share-links";
import { computeStatus } from "@/lib/share-links/status";
import { verifyUnlockCookie, cookieNameForSlug } from "@/lib/share-links/cookie";
import { UnavailableCard } from "@/components/public-share/unavailable-card";
import { PasswordForm } from "@/components/public-share/password-form";
import { LandingCard } from "@/components/public-share/landing-card";

export const dynamic = "force-dynamic";

async function timingFlattenedNotFound() {
  await new Promise((r) => setTimeout(r, 50));
  return <UnavailableCard reason="not-found" />;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const link = await getShareLinkBySlug(slug);
  if (!link) return { title: "Share" };
  const status = computeStatus(link, new Date());
  if (status !== "active") return { title: "Share" };

  const filename = link.key.split("/").pop() ?? link.key;
  return {
    title: filename,
    description: `Shared by ${link.createdByDisplayName}`,
    openGraph: {
      title: filename,
      description: `Shared by ${link.createdByDisplayName} via S3 Dock`,
      siteName: "S3 Dock",
      type: "website",
    },
  };
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const link = await getShareLinkBySlug(slug);
  if (!link) return await timingFlattenedNotFound();

  const status = computeStatus(link, new Date());
  if (status === "revoked") return <UnavailableCard reason="revoked" />;
  if (status === "expired") return <UnavailableCard reason="expired" />;
  if (status === "exhausted") return <UnavailableCard reason="exhausted" />;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = h.get("user-agent") ?? null;
  await recordShareLinkEvent({
    shareLinkId: link.id,
    action: "VIEW",
    ip,
    userAgent: ua,
    referrer: h.get("referer") ?? null,
  });

  if (link.passwordHash) {
    const c = await cookies();
    const cookieVal = c.get(cookieNameForSlug(slug))?.value;
    const ok = cookieVal ? (await verifyUnlockCookie(cookieVal)) === slug : false;
    if (!ok) return <PasswordForm slug={slug} error={error} />;
  }

  const teamLabel =
    link.connection.workspace.team?.name ??
    (link.connection.workspace.type === "PERSONAL" ? "Personal workspace" : "S3 Dock");

  let previewUrl = "";
  if (link.maxUses === null) {
    const previewClient = createS3Client({
      ...link.connection,
      secretAccessKey: decrypt(link.connection.secretAccessKey),
    });
    previewUrl = await getSignedUrl(
      previewClient,
      new GetObjectCommand({ Bucket: link.bucket, Key: link.key }),
      { expiresIn: 5 * 60 }
    );
  }

  return <LandingCard link={link} teamLabel={teamLabel} previewUrl={previewUrl} />;
}
