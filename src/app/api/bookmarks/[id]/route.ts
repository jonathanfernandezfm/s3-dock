import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { deleteBookmark } from "@/lib/db/bookmarks";

// DELETE /api/bookmarks/[id]
export const DELETE = withAuth(async (req, { user, params }) => {
  try {
    const { id } = await params;
    const deleted = await deleteBookmark(user.id, id);
    if (!deleted) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
