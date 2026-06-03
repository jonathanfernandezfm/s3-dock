import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listBookmarks, createBookmark } from "@/lib/db/bookmarks";

// GET /api/bookmarks?connectionId=...&bucket=...
export const GET = withAuth(async (req, { user }) => {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get("connectionId") ?? undefined;
    const bucket = searchParams.get("bucket") ?? undefined;
    const bookmarks = await listBookmarks(user.id, connectionId, bucket);
    return NextResponse.json(bookmarks);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

// POST /api/bookmarks  body: { connectionId, bucket, prefix? }
export const POST = withAuth(async (req, { user }) => {
  try {
    const { connectionId, bucket, prefix } = await req.json();
    if (!connectionId || !bucket) {
      return NextResponse.json({ error: "connectionId and bucket are required" }, { status: 400 });
    }
    const bookmark = await createBookmark(user.id, connectionId, bucket, prefix ?? null);
    if (!bookmark) {
      return NextResponse.json({ error: "Connection not found or access denied" }, { status: 403 });
    }
    return NextResponse.json(bookmark);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
