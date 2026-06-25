import { requireUser } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarDays, Mail, ShieldCheck } from "lucide-react";
import { TokensSection } from "./tokens-section";

const tierStyles: Record<string, string> = {
  FREE: "bg-secondary text-secondary-foreground",
  PRO: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  ENTERPRISE: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export default async function SettingsPage() {
  const user = await requireUser();

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

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || "User";
  const initials =
    [user.firstName?.[0], user.lastName?.[0]]
      .filter(Boolean)
      .join("")
      .toUpperCase() || user.email[0].toUpperCase();
  const tier = user.subscription?.tier ?? "FREE";
  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and preferences.
        </p>
      </div>

      <Card className="max-w-lg">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {user.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.imageUrl}
                alt={fullName}
                className="h-14 w-14 rounded-full object-cover ring-2 ring-border"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-semibold">
                {initials}
              </div>
            )}
            <div className="space-y-1">
              <p className="font-semibold">{fullName}</p>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tierStyles[tier] ?? tierStyles.FREE}`}
              >
                {tier}
              </span>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground w-24 shrink-0">Email</span>
              <span className="truncate">{user.email}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground w-24 shrink-0">Plan</span>
              <span>{tier.charAt(0) + tier.slice(1).toLowerCase()}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground w-24 shrink-0">
                Member since
              </span>
              <span>{memberSince}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <TokensSection
        initialTokens={tokens.map((t) => ({
          ...t,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          expiresAt: t.expiresAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
