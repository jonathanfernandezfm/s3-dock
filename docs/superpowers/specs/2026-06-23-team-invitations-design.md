# Team Invitations — Design

**Date:** 2026-06-23
**Scope:** Design spike specifying how to remove the "must already have an account" barrier from team membership, covering the data model for a new `Invitation` entity, the chosen delivery mechanism (tokenized invite link + auto-match on signup, i.e., Option A+B), acceptance flows, seat-cap interaction, lifecycle operations (revoke, resend, expiry), and all required UI surfaces. No code is produced here; this spec gates a subsequent build plan.

---

## Goal

Adding a teammate today requires the invitee to already have a registered account. `POST /api/teams/[teamId]/members` (`src/app/api/teams/[teamId]/members/route.ts`, lines 36–42) does a `prisma.user.findUnique({ where: { email } })`; if no row exists it returns:

```
404 "User not found. They must sign in at least once before being added."
```

There is no pending-invite concept, no acceptance flow, no resend or expiry, and no way to reach someone who has never visited the app. A team admin must tell the invitee "go create an account first, then come back and tell me" — a broken onboarding loop that prevents organic growth of team usage.

---

## Constraints

### Email provider check

```
$ grep -niE "resend|nodemailer|sendgrid|postmark|mailgun" package.json
```

Result: **no matches**. There is no transactional email provider in the project. Adding one (Option C) requires a new external dependency, new environment variables, deliverability configuration, and a new provider relationship.

### Invitation model check

```
$ grep -niE "invitation|teaminvite|invite" prisma/schema.prisma
```

Result: **no matches**. No `Invitation` or `TeamInvite` model exists. The addition is purely additive.

### Seat-cap invariant

`canAddTeamMember` (`src/lib/subscriptions/check-limits.ts`, lines 127–173) counts `team._count.members` — active `TeamMember` rows only. The limit for PRO is 5 members per team (from `TIER_LIMITS.PRO.teams.maxMembersPerTeam`, `src/lib/subscriptions/tiers.ts`). ENTERPRISE is unlimited (-1). FREE has teams disabled (0). This spec must decide whether a PENDING `Invitation` consumes a seat (see Open Questions).

### Last-admin invariant

`DELETE /api/teams/[teamId]/members/[memberId]` and `PATCH` (role change) both call `countAdmins(teamId)` and block if `adminCount <= 1` (`src/app/api/teams/[teamId]/members/[memberId]/route.ts`, lines 10–17, 39–47, 74–80). The acceptance flow must not circumvent this — it creates a new `TeamMember` (no admin demotion) so this invariant is never threatened at acceptance time.

### Existing team UI

The only current team UI is:
- `src/app/app/teams/page.tsx` — master-detail layout with team selector + `<TeamMembersCard>`
- `src/components/teams/team-members-card.tsx` — inline email form that calls `POST /api/teams/[teamId]/members` directly; shows 404 errors as notifications
- `src/components/teams/create-team-dialog.tsx` — team creation modal

There are no invite-related components.

---

## Changes

### 1. New Prisma model: `Invitation`

File: `prisma/schema.prisma` (additive — new enum + new model; no existing model modified)

```prisma
enum InvitationStatus {
  PENDING
  ACCEPTED
  REVOKED
  EXPIRED
}

model Invitation {
  id          String           @id @default(uuid())
  teamId      String
  team        Team             @relation(fields: [teamId], references: [id], onDelete: Cascade)
  email       String           // stored lowercased; mirrors members/route.ts email normalization
  role        TeamRole         @default(VIEWER)
  invitedById String
  invitedBy   User             @relation("InvitationSender", fields: [invitedById], references: [id], onDelete: Cascade)
  status      InvitationStatus @default(PENDING)
  token       String           @unique  // 32-char base62 from existing src/lib/share-links/slug.ts pattern
  expiresAt   DateTime         // default: createdAt + 14 days
  acceptedAt  DateTime?
  revokedAt   DateTime?

  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@unique([teamId, email])          // mirrors TeamMember @@unique([teamId, userId])
  @@index([token])
  @@index([teamId, status])
  @@index([email, status])           // for user.created webhook lookup
  @@map("invitations")
}
```

Reverse relations to add on existing models:

```prisma
// On Team:
invitations  Invitation[]

// On User:
sentInvitations  Invitation[]  @relation("InvitationSender")
```

Migration: `pnpm prisma migrate dev --name add_invitations`

Token generation reuses `src/lib/share-links/slug.ts` — extend `SLUG_LENGTH` usage or call `generateSlug()` twice and concatenate to produce a 32-char token with the same base62 alphabet. No new crypto primitive needed.

---

### 2. New route: `POST /api/teams/[teamId]/invites`

File: `src/app/api/teams/[teamId]/invites/route.ts`

Creates a new invitation. Replaces the "user not found" 404 path in the current members POST — the admin no longer needs the invitee to have an account first.

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import { isTeamAdmin } from "@/lib/db/teams";
import { canAddTeamMember } from "@/lib/subscriptions";
import { isTeamRole } from "@/lib/roles";
import { generateInviteToken } from "@/lib/invitations/token"; // new, mirrors slug.ts
import type { TeamRole } from "@/generated/prisma/client";

const INVITE_TTL_DAYS = 14;

type RouteContext = { params: Promise<{ teamId: string }> };

export const POST = withAuth<RouteContext>(async (req, { user, params }) => {
  const { teamId } = await params;

  if (!await isTeamAdmin(teamId, user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const memberCheck = await canAddTeamMember(teamId); // counts PENDING invites + members
  if (!memberCheck.allowed) {
    return NextResponse.json({ error: memberCheck.reason }, { status: 403 });
  }

  const body: { email?: string; role?: TeamRole } = await req.json();
  const email = body.email?.trim().toLowerCase();
  const role: TeamRole = body.role ?? "VIEWER";

  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (!isTeamRole(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  // Fast path: if the invitee already has an account, create TeamMember directly
  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (targetUser) {
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: targetUser.id } },
    });
    if (existing) {
      return NextResponse.json({ error: "User is already a member" }, { status: 409 });
    }
    const member = await prisma.teamMember.create({
      data: { teamId, userId: targetUser.id, role },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, imageUrl: true } } },
    });
    return NextResponse.json({ type: "member", member }, { status: 201 });
  }

  // Slow path: user not found — create a pending invite
  const existing = await prisma.invitation.findUnique({
    where: { teamId_email: { teamId, email } },
  });
  if (existing?.status === "PENDING") {
    return NextResponse.json({ error: "An invitation for this email is already pending" }, { status: 409 });
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

  const invitation = await prisma.invitation.upsert({
    where: { teamId_email: { teamId, email } },
    create: {
      teamId, email, role,
      invitedById: user.id,
      token: generateInviteToken(),
      expiresAt,
    },
    update: {
      // Re-invite after revoked/expired: refresh token, role, expiry, reset status
      role, status: "PENDING",
      invitedById: user.id,
      token: generateInviteToken(),
      expiresAt,
      revokedAt: null,
      acceptedAt: null,
    },
  });

  return NextResponse.json({
    type: "invitation",
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
    },
  }, { status: 201 });
});

export const GET = withAuth<RouteContext>(async (_req, { user, params }) => {
  const { teamId } = await params;

  if (!await isTeamAdmin(teamId, user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invitations = await prisma.invitation.findMany({
    where: { teamId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, role: true, status: true,
      expiresAt: true, createdAt: true,
      invitedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return NextResponse.json(invitations);
});
```

---

### 3. New route: `DELETE /api/teams/[teamId]/invites/[inviteId]`

File: `src/app/api/teams/[teamId]/invites/[inviteId]/route.ts`

Admin revokes a pending invitation. Soft-deletes by setting `status = "REVOKED"` and `revokedAt = now()`.

```ts
export const DELETE = withAuth<RouteContext>(async (_req, { user, params }) => {
  const { teamId, inviteId } = await params;

  if (!await isTeamAdmin(teamId, user.id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invite = await prisma.invitation.findUnique({ where: { id: inviteId } });
  if (!invite || invite.teamId !== teamId) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }
  if (invite.status !== "PENDING") {
    return NextResponse.json({ error: "Only pending invitations can be revoked" }, { status: 400 });
  }

  await prisma.invitation.update({
    where: { id: inviteId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });

  return NextResponse.json({ success: true });
});
```

---

### 4. New public route: `GET /api/invites/[token]` (preview) and `POST /api/invites/[token]/accept`

File: `src/app/api/invites/[token]/route.ts` and `src/app/api/invites/[token]/accept/route.ts`

The accept endpoint requires authentication (the invitee must be signed in as the invited email). The GET endpoint is public-ish: it returns enough metadata for the landing page to show team name and inviter, but not the token itself.

```ts
// GET /api/invites/[token] — unauthenticated, used by the accept page server component
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.invitation.findUnique({
    where: { token },
    include: { team: { select: { id: true, name: true, slug: true } },
               invitedBy: { select: { firstName: true, lastName: true } } },
  });

  if (!invite || invite.status !== "PENDING") {
    return NextResponse.json({ error: "Invitation not found or no longer valid" }, { status: 404 });
  }
  if (invite.expiresAt < new Date()) {
    // Mark expired lazily
    await prisma.invitation.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "This invitation has expired" }, { status: 410 });
  }

  return NextResponse.json({
    teamName: invite.team.name,
    role: invite.role,
    invitedByName: [invite.invitedBy.firstName, invite.invitedBy.lastName].filter(Boolean).join(" "),
    email: invite.email,
    expiresAt: invite.expiresAt,
  });
}

// POST /api/invites/[token]/accept — authenticated; invitee must be signed in
export const POST = withAuth(async (_req, { user, params }) => {
  const { token } = await params;
  const invite = await prisma.invitation.findUnique({
    where: { token },
    include: { team: true },
  });

  if (!invite || invite.status !== "PENDING") {
    return NextResponse.json({ error: "Invitation not found or no longer valid" }, { status: 404 });
  }
  if (invite.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "This invitation has expired" }, { status: 410 });
  }
  if (user.email.toLowerCase() !== invite.email) {
    return NextResponse.json(
      { error: "This invitation was sent to a different email address" },
      { status: 403 }
    );
  }

  // Seat check at accept time (in case team grew while invite was pending)
  const seatCheck = await canAddTeamMember(invite.teamId);
  if (!seatCheck.allowed) {
    return NextResponse.json({ error: seatCheck.reason }, { status: 403 });
  }

  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: invite.teamId, userId: user.id } },
  });
  if (existing) {
    // Already a member; mark invitation accepted anyway (idempotent)
    await prisma.invitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    return NextResponse.json({ teamId: invite.teamId, alreadyMember: true });
  }

  await prisma.$transaction([
    prisma.teamMember.create({
      data: { teamId: invite.teamId, userId: user.id, role: invite.role },
    }),
    prisma.invitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ teamId: invite.teamId });
});
```

---

### 5. New public accept page

File: `src/app/(public)/invite/[token]/page.tsx`

Server component. Fetches invite metadata via the GET endpoint. If the user is signed in (Clerk `currentUser()`), shows an "Accept & join [team name]" button that calls the accept route. If not signed in, shows "Sign in to accept" linking to `/sign-in?redirect_url=/invite/[token]`.

```
┌──────────────────────────────────────────────────────────┐
│  You have been invited to join                           │
│                                                          │
│  Acme Corp                                               │
│  as Viewer                                               │
│  Invited by: Jonathan Fernandez                          │
│  Expires: Jul 7, 2026                                    │
│                                                          │
│  [Accept invitation]      [Decline / ignore]             │
│                                                          │
│  This invitation was sent to: alice@example.com          │
└──────────────────────────────────────────────────────────┘
```

On accept success: redirect to `/app/teams` with a success notification. On mismatch (wrong account signed in): show "This invitation was sent to [email]; you are signed in as [current email]."

The page lives in the `(public)` route group — no Clerk `protect()` wrapper — so unauthenticated users can land there. However the API accept endpoint does require auth.

---

### 6. Clerk `user.created` webhook change — auto-attach pending invites

File: `src/app/api/webhooks/clerk/route.ts`

After creating the `User` row in the `user.created` case (inside or immediately after the `upsert`), look up any PENDING invitations for the new user's email and convert them to `TeamMember` rows. This is the "Option A" fallback that handles the case where someone was invited, signed up via Clerk's own email link (or navigated to sign-up directly), and expects to land in the team without clicking an invite link.

```ts
case "user.created": {
  // ... existing upsert ...

  // Auto-attach pending invitations
  const newUser = await prisma.user.findUnique({ where: { clerkId: id } });
  if (newUser) {
    const pendingInvites = await prisma.invitation.findMany({
      where: { email: newUser.email, status: "PENDING" },
    });
    if (pendingInvites.length > 0) {
      await prisma.$transaction(
        pendingInvites.map((inv) =>
          prisma.teamMember.upsert({
            where: { teamId_userId: { teamId: inv.teamId, userId: newUser.id } },
            create: { teamId: inv.teamId, userId: newUser.id, role: inv.role },
            update: {}, // already a member, no-op
          })
        )
      );
      await prisma.invitation.updateMany({
        where: { id: { in: pendingInvites.map((i) => i.id) } },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
    }
  }
  break;
}
```

Note: the auto-attach does not check the seat cap per invite — it fires from a trusted webhook after signup, not from an admin action. Seat checks happen at invite-creation time (when the admin sends the invite) and at token-acceptance time (when the invitee clicks the link). Auto-attach on signup is the residual path; if the team filled up between invite-send and signup, the seat-check at invite-creation time should have been the blocker. A future hardening pass can add a seat check here too, but for v1, skipping it keeps the webhook handler simple and avoids orphaning a new user who signed up specifically to join a team.

---

### 7. New library: `src/lib/invitations/token.ts`

Reuses the same base62 alphabet and `randomBytes` approach as `src/lib/share-links/slug.ts`. Token is 32 characters (vs 8 for share-link slugs) to provide ~190 bits of entropy — effectively unguessable even with 10^9 attempts/day over a year.

```ts
import { randomBytes } from "crypto";
import { SLUG_ALPHABET } from "@/lib/share-links/slug";

const TOKEN_LENGTH = 32;

export function generateInviteToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return out;
}
```

---

### 8. Updated `canAddTeamMember` to count pending invitations

File: `src/lib/subscriptions/check-limits.ts`

Change the member count to include PENDING invitations so a team cannot over-invite past its tier limit (recommended — see Open Questions for rationale and alternative).

```ts
export async function canAddTeamMember(teamId: string): Promise<LimitCheckResult> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      createdBy: { include: { subscription: true } },
      _count: { select: { members: true } },
    },
  });

  if (!team) return { allowed: false, reason: "Team not found." };

  const tier: SubscriptionTier = team.createdBy.subscription?.tier ?? "FREE";
  const limit = TIER_LIMITS[tier].teams.maxMembersPerTeam;

  if (isUnlimited(limit)) return { allowed: true };
  if (limit === 0) return {
    allowed: false,
    reason: `Teams are not available on the team creator's ${tier} plan.`,
    current: team._count.members, limit: 0,
  };

  const pendingCount = await prisma.invitation.count({
    where: { teamId, status: "PENDING" },
  });

  const currentCount = team._count.members + pendingCount;

  if (currentCount >= limit) {
    return {
      allowed: false,
      reason: `This team has reached the maximum of ${limit} member${limit === 1 ? "" : "s"} for a ${tier} plan (including ${pendingCount} pending invite${pendingCount === 1 ? "" : "s"}). Upgrade to add more members.`,
      current: currentCount, limit,
    };
  }

  return { allowed: true, current: currentCount, limit };
}
```

---

### 9. UI — pending invitations section in `TeamMembersCard`

File: `src/components/teams/team-members-card.tsx` (update) and `src/lib/queries/teams.ts` (add `useTeamInvitations`, `useCreateInvitation`, `useRevokeInvitation` hooks)

Below the existing members list, add a "Pending Invitations" section visible only to admins (`canManage`). Each row shows: email, role badge, "Expires [relative date]", and a "Revoke" button.

The "Add member" form remains visually identical. The `onAddMember` handler is rewired to call `POST /api/teams/[teamId]/invites` instead of the members endpoint. On success it branches on the response `type`:
- `"member"` — show toast "Alice added as Viewer" (they were already registered)
- `"invitation"` — show toast "Invitation sent to alice@example.com — share the link: /invite/[token]" with a copy-link button

The invite link must be displayed inline in the card after creation because there is no email delivery in v1. The admin is expected to copy and share it manually (Slack, email, etc.). This is an intentional UX acknowledgment of the no-email-provider constraint.

```
┌──────────────────────────────────────────────────────┐
│ Members (3)                                          │
│                                                      │
│ [email] [role ▼]  [Add]                              │
│                                                      │
│ Jonathan Fernandez  admin@co.com    ADMIN  [⋮]       │
│ Alice Smith         alice@co.com    EDITOR [⋮]       │
│ Bob Jones           bob@co.com      VIEWER [⋮]       │
│                                                      │
│ Pending Invitations (1)             [ADMIN only]     │
│ carol@co.com    VIEWER   Expires 7 Jul   [Revoke]    │
│                                                      │
│  Invite link (copy and share manually):              │
│  [https://app/invite/Xk8...]  [Copy]                 │
└──────────────────────────────────────────────────────┘
```

---

## Data Flow

```
INVITE CREATION
───────────────
Admin enters email + role → POST /api/teams/[teamId]/invites
  ├─ isTeamAdmin check (403 if not admin)
  ├─ canAddTeamMember: count(members) + count(PENDING invites) vs. tier limit (403 if over cap)
  ├─ Email already has a User row?
  │   YES → create TeamMember directly → return { type: "member" }
  │   NO  → upsert Invitation(PENDING, token, expiresAt = now+14d)
  │          → return { type: "invitation", token }
  └─ Admin copies /invite/[token] and shares it manually (no email sent in v1)


TOKEN ACCEPTANCE (Option B — tokenized link)
────────────────────────────────────────────
Invitee opens /invite/[token] (public page)
  ├─ GET /api/invites/[token] → returns teamName, role, inviterName, email, expiresAt
  │   ├─ invite not found / status != PENDING → 404 "not valid"
  │   └─ expiresAt < now → mark EXPIRED → 410 "expired"
  │
  ├─ Invitee not signed in?
  │   → "Sign in to accept" → /sign-in?redirect_url=/invite/[token]
  │   → After Clerk sign-in/sign-up, redirected back to /invite/[token]
  │
  └─ Invitee signed in → "Accept & join [Team Name]"
       → POST /api/invites/[token]/accept (authenticated)
           ├─ withAuth: user must be authenticated
           ├─ invite.status check (404 / 410 as above)
           ├─ user.email === invite.email check (403 if mismatch)
           ├─ canAddTeamMember seat check (403 if team now full)
           ├─ already a TeamMember? → mark ACCEPTED, return { alreadyMember: true }
           └─ $transaction: create TeamMember + mark invitation ACCEPTED
               → redirect to /app/teams


AUTO-ATTACH ON SIGNUP (Option A fallback)
─────────────────────────────────────────
Invitee signs up via Clerk (without clicking invite link)
  → Clerk fires user.created webhook → /api/webhooks/clerk
  → upsert User row (existing behavior)
  → findMany Invitation where email = newUser.email AND status = PENDING
  → $transaction: upsert TeamMember for each pending invite
  → updateMany invitations → status = ACCEPTED
  (No seat check; invite-creation seat check was the gate)


INVITE LIFECYCLE
────────────────
Admin revokes: DELETE /api/teams/[teamId]/invites/[inviteId]
  → invitation.status = "REVOKED", revokedAt = now()

Expiry: lazy (on token access) OR nightly background job (optional, v2)
  → invitation.status = "EXPIRED"

Resend: POST /api/teams/[teamId]/invites with same email
  → upsert path: refreshes token, expiresAt, status = PENDING, revokedAt = null
  → admin gets new invite link to share
```

---

## Error States

| Scenario | Route | Response | User sees |
|---|---|---|---|
| Invitee is already a `TeamMember` | `POST /invites` | 409 "User is already a member" | Toast: "This person is already on the team" |
| Duplicate PENDING invite for same email | `POST /invites` | 409 "An invitation for this email is already pending" | Toast: "There is already a pending invite for this email — revoke it first or wait for it to expire" |
| Seat cap reached at invite time (members + pending invites) | `POST /invites` | 403 with tier-specific reason | Toast: "[reason] Upgrade to add more members." |
| Seat cap reached at accept time (team filled after invite was sent) | `POST /invites/[token]/accept` | 403 with tier-specific reason | Accept page: "This team has reached its member limit. Contact the team admin." |
| Token not found or not PENDING | `GET/POST /invites/[token]` | 404 "not valid" | Accept page: "This invitation is no longer valid or does not exist." |
| Token expired (`expiresAt < now`) | `GET/POST /invites/[token]` | 410 "expired" | Accept page: "This invitation expired on [date]. Ask your admin to send a new one." |
| Invitee signed in as wrong email | `POST /invites/[token]/accept` | 403 "sent to a different email" | Accept page: "This invitation was sent to [invited email]. You are signed in as [current email]. Sign in with the invited address or ask for a new invitation." |
| Non-admin calls `POST /invites` | `POST /invites` | 403 "Forbidden" | Toast: "Only team admins can send invitations" |
| Non-admin calls revoke | `DELETE /invites/[inviteId]` | 403 "Forbidden" | Toast: "Only team admins can revoke invitations" |
| Revoke on non-PENDING invite | `DELETE /invites/[inviteId]` | 400 "Only pending invitations can be revoked" | Toast: "This invitation has already been accepted or revoked" |

---

## Open Questions

| Question | Recommended answer |
|---|---|
| **Delivery mechanism: A, B, or C?** | **A+B combined.** Option B (tokenized link) is the primary acceptance flow — mirrors the existing `ShareLink` slug pattern in `src/lib/share-links/slug.ts`, zero new dependencies, admin shares the link via their own channel. Option A (auto-attach on Clerk `user.created`) is the fallback for invitees who sign up without using the link. Option C (email via external provider) is deferred — it would add the most friction to the invitee but requires a new dependency, new env vars, and ongoing deliverability work; it is a v2 enhancement once the core flow is validated. |
| **Expiry duration?** | **14 days.** Shorter than the 30-day default some products use, reflecting that team invitations should be acted on promptly. 7 days may be too tight if the invitee is on holiday; 30 days is longer than most sprint cycles. Resend re-sets the clock without requiring revoke-then-re-invite. |
| **Does a PENDING invite consume a seat?** | **Yes — count PENDING invites + active members against the tier cap.** A PRO team with 5-seat limit and 4 members cannot have 4 pending invites outstanding (that would be 8 effective promises). Consuming a seat on invite-creation prevents over-provisioning. The alternative (only count accepted members) allows a malicious or careless admin to send unlimited invites on any tier; the first 5 to accept would win and the rest would get a "team is full" error at accept time — confusing for recipients who followed a valid link. Counting pending invites as seats avoids this. The trade-off: a pending invite locks a seat; if the invitee never accepts, the admin must revoke to reclaim the seat. This is documented in the UI. |
| **Keep or replace the existing add-by-email fast path?** | **Keep as a fast path, routed through the new invites endpoint.** The `POST /api/teams/[teamId]/invites` handler checks whether the email already has a `User` row and creates a `TeamMember` directly if so (same behavior as the current members POST). This is strictly better: the admin experience is identical for registered users, and the fallback to a pending invite is seamless. The existing `POST /api/teams/[teamId]/members` can remain for backward compatibility but should be marked deprecated; the UI should only call the new invites endpoint. |
| **Should invite tokens be single-use (revoked on acceptance)?** | **No — leave status at ACCEPTED, do not make the token invalid.** The `@@unique([teamId, email])` constraint on `Invitation` ensures at most one active invite per email per team. Once accepted, the `status = "ACCEPTED"` check blocks re-use. There is no need for a separate "consumed" mechanism. |
| **Nightly expiry job?** | **Defer to v2.** Expiry is checked lazily on token access. For v1, expired invites are not cleaned up proactively; they remain as PENDING rows until the invitee tries the link or the admin revokes. A nightly `cron` job that marks `status = "EXPIRED"` where `expiresAt < now AND status = "PENDING"` is a straightforward v2 addition. |

---

## Out of Scope

The following are explicitly deferred; do not include in the build plan that follows this spec:

- **Bulk invitations** — sending invites to multiple emails in one request. The POST endpoint accepts one email per call; the UI can fan-out client-side if needed.
- **SCIM / SSO provisioning** — enterprise directory sync; requires a dedicated provisioning layer and is a standalone feature.
- **Per-resource (not per-team) invitations** — sharing a single S3 connection with an external user without full team membership. A distinct access model; deferred.
- **Email delivery (Option C)** — adding Resend, SendGrid, Postmark, or equivalent. The in-app invite-link copy UX is sufficient for v1. Email delivery is a v2 enhancement that can be layered on without changing the data model.
- **Ownership transfer** — transferring `Team.createdById` to another admin. Distinct from invitation acceptance; involves subscription re-attribution. Deferred (noted in `plans/README.md` deferred list).
- **Workspace-shared bookmarks** — currently `Bookmark` is user-scoped (`userId`); team-scoped bookmarks are a separate data model change. Deferred (also noted in `plans/README.md` deferred list).
- **Invitation analytics** — tracking how many invites were sent, accepted, and declined per team over time.
- **Admin notifications on invitation acceptance** — notifying the inviting admin when someone accepts; requires either polling or a push mechanism.
