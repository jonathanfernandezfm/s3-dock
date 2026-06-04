# Subscription Tiers Design

**Date:** 2026-06-04  
**Status:** Approved  
**Product:** S3 Dock

---

## Overview

S3 Dock will offer a tier-based subscription model to support a sustainable indie product while keeping a genuinely useful free tier. The target audience is individual developers managing S3-compatible storage. PRO unlocks advanced features and higher limits for power users.

---

## Tier Definitions

| Feature | FREE | PRO ($4/mo) | ENTERPRISE |
|---|---|---|---|
| Connections | 2 | 10 | Unlimited |
| Single file upload | 50 MB | Unlimited | Unlimited |
| Monthly bandwidth | Unlimited | Unlimited | Unlimited |
| Operations / month | 1,000 | 50,000 | Unlimited |
| Share links | ✗ | ✓ (password, expiry, analytics) | ✓ |
| Teams | ✗ | ✓ (1 team, 5 members) | ✓ Unlimited |
| File notes | ✓ | ✓ | ✓ |
| Activity log retention | 30 days | 90 days | Unlimited |
| Billing | Free forever | Stripe Checkout | Contact us |

**Notes:**
- Monthly bandwidth (upload/download) is tracked in `UsageRecord` for informational purposes only — it is not enforced as a cap. Data transfers go through the user's own S3 endpoint, not S3 Dock infrastructure.
- The 50 MB single-file limit on FREE applies at the API layer on file select in the UI.
- Operations are counted per S3 API call (list, copy, move, rename, delete, tag, folder create). Uploads and downloads also count as operations.

---

## Stripe Integration

### Payment flow

- **New subscriptions:** User clicks "Upgrade to PRO" → `POST /api/billing/checkout` creates a Stripe Checkout Session → user is redirected to Stripe's hosted checkout page → on success, Stripe fires a webhook → `POST /api/webhooks/stripe` updates the `Subscription` row in the database (tier, stripeCustomerId, stripeSubscriptionId, etc.) → user lands back in the app with tier refreshed via React Query.
- **Plan management / cancellation:** "Manage Billing" button in Settings → Billing calls `POST /api/billing/portal` which creates a Stripe Customer Portal session → Stripe handles everything (invoices, cancellation, payment method updates).
- **ENTERPRISE:** No self-serve checkout. The pricing modal shows a "Contact us" button that links to an email or contact form. Pricing is negotiated per customer.

### Webhook events handled

| Event | Action |
|---|---|
| `checkout.session.completed` | Set tier to PRO, store Stripe IDs, set billing period |
| `customer.subscription.updated` | Update billing period, handle plan changes |
| `customer.subscription.deleted` | Downgrade tier to FREE, clear Stripe subscription ID |
| `invoice.payment_failed` | Flag subscription as past-due (future: grace period handling) |

### New files

- `src/lib/stripe.ts` — Stripe client singleton (initialised with `STRIPE_SECRET_KEY`)
- `src/app/api/billing/checkout/route.ts` — create Checkout Session
- `src/app/api/billing/portal/route.ts` — create Customer Portal session
- `src/app/api/webhooks/stripe/route.ts` — handle subscription lifecycle events

### Environment variables

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
```

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not needed — Stripe Checkout is a server-side redirect and does not use Stripe.js on the client.

---

## Feature Gate Architecture

### Approach

Dual enforcement: React component gates in the UI, server-side checks in API routes. PRO-only pages (Shares, Teams) are not blocked at the middleware level — they render normally but display a locked overlay component. The existing Clerk middleware in `src/middleware.ts` is not changed.

### `tiers.ts` additions

The existing `src/lib/subscriptions/tiers.ts` is extended with new fields:

```ts
shareLinks: boolean;
teams: {
  enabled: boolean;
  maxTeams: number;           // -1 = unlimited
  maxMembersPerTeam: number;  // -1 = unlimited
};
activityRetentionDays: number; // -1 = unlimited
```

### `<FeatureGate>` component

`src/components/shared/feature-gate.tsx` wraps any PRO-locked UI element. For FREE users it renders a dimmed version of the child with a "PRO" badge and an upgrade tooltip on hover. For PRO/ENTERPRISE users it renders the child as-is.

```tsx
<FeatureGate feature="shareLinks">
  <ContextMenuItem>Share...</ContextMenuItem>
</FeatureGate>
```

### `useTier()` hook

`src/hooks/use-tier.ts` reads the current user's subscription tier from React Query (same cache as the user profile). Returns `{ tier, limits, can(feature) }`.

### New gate in `src/lib/subscriptions/gates.ts`

Maps feature names to tier requirements. Used by both `<FeatureGate>` and server-side checks.

```ts
export const FEATURE_GATES = {
  shareLinks: ["PRO", "ENTERPRISE"],
  teams:      ["PRO", "ENTERPRISE"],
} satisfies Record<string, Tier[]>
```

---

## Enforcement Map

| Feature | Gate type | UI behaviour | API enforcement |
|---|---|---|---|
| 3rd+ connection | Hard limit | "Add Connection" dimmed at 2/2 with tooltip | `canCreateConnection()` — existing |
| Upload >50 MB (FREE) | Hard limit | Blocked on file select with error toast | `canUploadFileSize()` — existing |
| Operations/month at 80% | Warning | Toast warning shown | `canPerformOperation()` — existing |
| Operations/month at 100% | Hard limit | Operation blocked with toast | `canPerformOperation()` — existing |
| Share links | Feature gate | Dimmed in context menu with PRO badge; `/shares` page shows locked overlay; sidebar item dimmed with PRO badge | New check in `POST /api/share-links` |
| Teams | Feature gate | `/teams` page shows locked overlay; sidebar item dimmed with PRO badge | New check in `POST /api/teams` |
| Activity log >30 days (FREE) | Query gate | Older entries hidden; "Upgrade for full history" banner | Date filter in `GET /api/activity` |

---

## UI Components

### Settings → Billing tab

Location: `src/app/(dashboard)/settings/billing/` (new tab within existing settings layout)

Contents:
- **Current plan card** — displays tier name, status badge, and a "View plans" button top-right
- **Usage meters** — operations (enforced), connections (enforced), upload volume (informational). Progress bars go amber at 80%, red at 100%.
- **Contextual nudge** — appears only when a limit is at 100%, e.g. "You've used all 2 connections. Upgrade to PRO to add up to 10."
- **Manage Billing button** — shown only for PRO users; opens Stripe Customer Portal

### Plans modal

Triggered by the "View plans" button. A Radix `<Dialog>` with a 3-column plan comparison (FREE / PRO / ENTERPRISE). FREE column shows "Current plan" button (inactive). PRO column shows "Upgrade to PRO — $4/mo" CTA that calls `POST /api/billing/checkout`. ENTERPRISE column shows "Contact us".

### Sidebar navigation (FREE users)

PRO-only nav items (Shares, Teams) remain visible but are visually dimmed with a small "PRO" badge. Clicking navigates to the page, which shows a locked overlay (see below).

### Page-level locked overlay

Applied to `/shares` and `/teams` for FREE users. Renders the page chrome normally but overlays the content area with:
- Feature name and icon
- One-line description of what the feature does
- "Upgrade to PRO — $4/mo" CTA button

### Inline PRO badge + tooltip (context menus / buttons)

`<FeatureGate>` renders the wrapped child dimmed with a "PRO" chip. On hover, a tooltip appears: "Share Links · PRO feature — Upgrade for $4/mo →". Clicking the tooltip link opens the Plans modal.

---

## Data Model Changes

The `Subscription` model already has all required fields (`tier`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`). No schema migration is needed.

`UsageRecord` is retained for informational tracking (upload/download bytes, operation count). Bandwidth fields are no longer used for enforcement but remain for the usage dashboard.

---

## What Is NOT in Scope

- Annual billing / discounts
- Proration on plan changes (handled by Stripe automatically)
- Grace period for failed payments (future iteration)
- Email notifications for usage warnings (future iteration)
- ENTERPRISE self-serve checkout
- A public marketing `/pricing` page (billing lives inside the app in Settings)
