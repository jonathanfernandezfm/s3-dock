import { SignJWT, jwtVerify } from "jose";

export const COOKIE_TTL_SECONDS = 30 * 60;
export const COOKIE_NAME_PREFIX = "share_unlock_";

function getSecret(): Uint8Array {
  const hex = process.env.SHARE_LINK_COOKIE_SECRET;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "SHARE_LINK_COOKIE_SECRET must be a 64-character hex string (32 bytes)"
    );
  }
  return new TextEncoder().encode(hex);
}

export async function signUnlockCookie(slug: string): Promise<string> {
  return new SignJWT({ slug })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyUnlockCookie(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (typeof payload.slug !== "string") return null;
    return payload.slug;
  } catch {
    return null;
  }
}

export function cookieNameForSlug(slug: string): string {
  return `${COOKIE_NAME_PREFIX}${slug}`;
}
