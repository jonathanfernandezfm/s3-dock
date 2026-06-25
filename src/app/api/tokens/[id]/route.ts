import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";

export const DELETE = withAuth(async (_req, { user, params }) => {
  const { id } = params as { id: string };

  const token = await prisma.mcpToken.findUnique({ where: { id } });

  if (!token || token.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.mcpToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
});
