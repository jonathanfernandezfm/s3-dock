# Buckets View — Workspace vs Connection Hierarchy

**Date:** 2026-06-03
**Scope:** `src/components/buckets/bucket-list.tsx`

## Problem

The default Buckets view renders workspaces and the connections inside them with
near-identical visual treatment:

- Icon + bold heading + uppercase role pill + full-width border-bottom
- Type contrast is `text-xl/700` vs `text-lg/600` — too subtle to read as parent/child
- Both icons share `text-muted-foreground`
- No indentation or containment to express nesting

Result: users can't tell at a glance whether they're looking at a workspace name
or a connection name. The hierarchy is logically clear in the data but visually flat.

## Decision

Adopt direction **B1** (validated visually via brainstorming companion):
**Workspace becomes a quiet uppercase section label; the connection becomes the
primary heading.**

Rationale: the connection is what the user *acts on* (it's the actual S3 endpoint
they'll browse). The workspace is contextual ownership. Demoting the workspace
to a label and elevating the connection name matches that mental model and
breaks the visual ambiguity by giving each level a fundamentally different role
in the type system — heading vs. label.

## Visual Treatment

### Workspace label (the demoted level)

- Render as a small uppercase tracking-wide label, not a heading.
- Color: `text-muted-foreground/70` (faint — should feel like a category tag, not a section header).
- Font: `text-[10px] uppercase tracking-[0.12em] font-semibold`.
- Inline content (in order): workspace icon (`Users` for TEAM, `Briefcase` for PERSONAL), workspace name, role tag (`· ADMIN` / `· VIEWER`) rendered as plain inline text in even lighter gray (`text-muted-foreground/50`) — no border pill.
- No border-bottom under the label.
- **Always render the label**, even when only one workspace exists. Consistent layout matters more than the noise saved.

### Between workspaces

- Subtle horizontal separator (`border-t border-border/50`) above each workspace label *except the first*.
- Vertical rhythm: keep the existing `space-y-10` between workspace groups; the rule appears as a thin divider inside that gap.

### Connection header (the elevated level)

- Becomes the primary visible heading on the page.
- Font: **unchanged** — stays at `text-lg font-semibold`. The improvement comes from demoting the workspace, not from re-sizing the connection. With nothing competing above it, `text-lg font-semibold` reads correctly as the page's primary heading.
- Keep: `Server` icon, connection role pill (uppercase border style — unchanged), bucket count (`text-sm text-muted-foreground`), `CreateBucketDialog` button on the right.
- Keep the `border-b pb-3` under the connection header — it visually separates the header from the bucket card grid below. (This rule was confusing *only* when paired with an identical rule above on the workspace; with the workspace demoted to a label, the rule reads correctly as "header for the cards below.")

### Role display: workspace vs connection

Both roles are shown, intentionally — they are different facts (the user's
role *in the workspace* vs *on this specific connection*). They render
differently to reinforce that:

- Workspace role → inline text in the label (`· ADMIN`)
- Connection role → existing uppercase border pill (unchanged)

## Edge Cases

- **Empty workspace** (workspace exists but contributes no connection groups): filtered out before the map (see Implementation Scope #2). Preserves existing behavior where empty workspaces don't render.
- **First workspace**: no top border above its label (no separator before the first group).
- **Single connection with no buckets**: the existing "No buckets found" empty state inside the connection block is unchanged.
- **Workspace label icon for unknown types**: only `TEAM` and `PERSONAL` exist in the schema; no fallback needed.

## Implementation Scope

Single file: `src/components/buckets/bucket-list.tsx`, lines 95–186 (the JSX return).

Specifically:

1. Workspace `<div>` header block at line 101–111 becomes the new label markup (no border-bottom, smaller text, inline role tag in lighter gray, no border pill for the workspace role).
2. Pre-filter `workspaceGroups` to only those with `wsGroups.length > 0` *before* the `.map(...)`, so the rendered-workspace index is reliable. Render the `border-t border-border/50` separator only when index is `> 0` (skip above the first rendered workspace). The current inline `if (wsGroups.length === 0) return null` short-circuit (line 98) is removed in favor of the pre-filter.
3. Connection `<h3>` at line 123 stays as `text-lg font-semibold` — unchanged. Everything else in the connection header row stays.

No changes to:

- `bucket-card.tsx`
- `useAllBuckets`, `useWorkspaces`, or any query hook
- Empty / error states
- Bucket card grid layout

## Out of Scope

- Sticky workspace label on scroll
- Collapsible workspace groups
- Per-workspace color dots or accents (rejected during brainstorming as not justified at current workspace counts)
- Restructuring connection-level layout (action button placement, role pill style, etc.)
- Any change to the file browser (`tab-content.tsx`) — the workspace/connection differentiation problem only exists in the buckets list view
