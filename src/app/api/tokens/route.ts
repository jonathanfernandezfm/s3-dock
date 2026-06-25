import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { issueMcpToken } from "@/lib/auth/mcp-token";
import prisma from "@/lib/db/prisma";

export const GET = withAuth(async (_req, { user }) => {
  const tokens = await prisma.mcpToken.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return NextResponse.json(tokens);
});

export const POST = withAuth(async (req, { user }) => {
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Token name is required" }, { status: 400 });
  }

  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
  if (expiresAt && isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "Invalid expiresAt date" }, { status: 400 });
  }

  const { token, record } = await issueMcpToken(user.id, name, { expiresAt });

  return NextResponse.json(
    {
      token,
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    },
    { status: 201 }
  );
});
