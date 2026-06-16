# Split Properties Into Its Own Drawer — Design

**Date:** 2026-06-13
**Status:** Approved (pending user review of this spec)

## Problem

The right sidepanel (info drawer) currently hosts four tabs — Activity, Notes,
Versions, Properties — under a single global scope
`{ connectionId, bucket, prefix?, objectKey? }`. The tabs disagree about their
subject: Activity/Versions follow `objectKey` when set else the folder, Notes is
folder-only, and Properties requires `objectKey`. Because the only action that
ever sets `objectKey` is "Open Properties", and because `objectKey` survives
drawer close and tab switches, users routinely see Activity or Versions filtered
to a file that is no longer selected anywhere in the UI — with no visible,
dismissible indication of why.

## Summary

Split the sidepanel into **two independent, mutually exclusive right drawers**:

- **Info drawer** (existing, minus Properties) — Activity / Notes / Versions.
  Keeps file/folder scoping, but the file subject becomes **visible and
  dismissible**, and is reached through explicit menu actions rather than as a
  side effect of opening Properties.
- **Properties drawer** (new) — Properties only, **always file-scoped**. Opened
  from the file 3-dots menu / Properties button.

Opening either drawer closes the other.

## Goals

- Give each drawer one unambiguous subject: properties = a file; info drawer =
  the current folder/bucket, or an explicitly chosen file.
- Make the info drawer's file subject visible (a chip in the header) and
  dismissible (✕ returns to folder scope).
- Preserve the ability to view a single file's Activity and Versions — reached
  via new explicit file-menu items.
- Keep Notes exactly as today (folder-only).
- Follow existing patterns: Zustand drawer store, React Query hooks, the
  existing `PropertiesTab`/`PropertiesForm` UI.

## Non-Goals

- Auto-following browser selection (deferred; menu actions remain the trigger).
- Showing both drawers simultaneously (mutually exclusive for now; right-edge
  space doesn't allow side-by-side at 380px).
- Any change to Notes scoping, the version history dialog, or activity logging.
- Multi-select scoping.

## Approaches Considered

1. **Two drawers, Properties standalone** (chosen) — clean subject separation;
   each component stays small and single-purpose; deletes the sticky-`objectKey`
   bug class for Properties while keeping file scoping available for
   Activity/Versions via explicit actions.
2. Single drawer, selection-driven (Drive model) — strong long-term model but
   changes current behavior the most and forces multi-select and
   notes-on-files decisions now. Deferred; this design leaves the door open to it.
3. Single drawer, keep Properties tab but add a visible/dismissible subject chip
   only — smallest change, but keeps four mismatched subjects under one header.

## Architecture

### Stores

- **`info-drawer-store`** (existing) — two changes:
  - `InfoDrawerTab` drops `"properties"` → `"activity" | "notes" | "versions"`.
  - `close()` clears `objectKey` from scope (keeps `connectionId/bucket/prefix`),
    in addition to clearing `userFilter`/`actionFilter` as today. So reopening
    the drawer returns to folder scope, never a stale file.
  - Mutual exclusivity: `open()`/`toggle()` first call
    `usePropertiesDrawerStore.getState().close()`.

- **`properties-drawer-store`** (new) —
  ```ts
  type PropertiesDrawerScope = { connectionId: string; bucket: string; objectKey: string };
  interface PropertiesDrawerState {
    isOpen: boolean;
    scope: PropertiesDrawerScope | null;
    open: (scope: PropertiesDrawerScope) => void;  // also closes info drawer
    close: () => void;
  }
  ```
  No tabs, no `prefix`-only state, no folder scope — it only ever describes a file.

### Components

- **`src/components/properties-drawer/properties-drawer.tsx`** (new) — a right
  drawer mirroring the info-drawer chrome (fixed, 380px, slide-in, Escape to
  close, click-scrim to close). Header shows the file icon + filename + close
  button; no tab strip. Body renders the existing `PropertiesTab` content moved
  here, reading from `properties-drawer-store`.
- **`PropertiesTab` → Properties drawer body.** The existing
  `PropertiesTab`/`PropertiesForm` in `src/components/info-drawer/properties-tab.tsx`
  moves to `src/components/properties-drawer/` and reads
  `connectionId/bucket/objectKey` from the new store. The "Select a file and
  choose Properties" empty state is removed — the drawer never opens without a
  file. `PropertiesForm` itself is unchanged.
- **`info-drawer.tsx`** — remove `"properties"` from `TAB_META`, `TAB_ORDER`,
  the `PropertiesTab` import, and the Properties branch in the body. Add a
  dismissible file-subject chip to the header: when `scope.objectKey` is set,
  render `📄 <filename> ✕`; ✕ calls `setScope({ ...scope, objectKey: undefined })`.
  Filename derives from `objectKey` (basename of the key).
- **`app/app/layout.tsx`** — mount `<PropertiesDrawer />` next to `<InfoDrawer />`.

### Entry points (file 3-dots menu in `file-row.tsx` and `file-tile.tsx`)

- **Properties** (existing item, repointed): call
  `usePropertiesDrawerStore.open({ connectionId, bucket, objectKey: object.key })`
  instead of `setInfoScope(...) + openInfoDrawer("properties")`.
- **Activity** (new item): `setInfoScope({ connectionId, bucket, prefix, objectKey: object.key })`
  then `openInfoDrawer("activity")`.
- **Versions** (new item): same scope, `openInfoDrawer("versions")`. (Gate behind
  the existing `list-versions` capability / `hasVersioning`, consistent with the
  toolbar Versions button.)

The toolbar Activity/Notes/Versions buttons are unchanged and continue to open
the info drawer at folder/bucket scope (the file subject is only set by the new
menu items and cleared on navigation away / close).

## Behavior Matrix

| Trigger | Result |
|---|---|
| Toolbar Activity / Notes / Versions | Info drawer, folder/bucket scope |
| File menu → Properties | Properties drawer, that file (info drawer closes) |
| File menu → Activity / Versions | Info drawer, that file; subject chip shown, ✕ clears (properties drawer closes) |
| ✕ on info-drawer subject chip | Info drawer drops to folder scope |
| Navigate to another folder (info open) | Info drawer follows folder; file subject kept only if still a direct child (existing rule) |
| Close info drawer | `objectKey` cleared; folder context retained |
| Close properties drawer | No effect on info drawer |
| Open one drawer while the other is open | The other closes |

## Edge Cases

- **Properties drawer open, user navigates folders:** the drawer keeps showing
  the originally chosen file (its scope is self-contained, not tied to the
  browser path). Closing returns to the browser. This matches "properties = the
  file I picked", and avoids the info drawer's navigation-sync complexity.
- **Dual-pane:** both panes' menus write to the same global stores; the drawer
  reflects the last action, as today. No per-pane ownership introduced here.
- **Non-browser pages (e.g. bucket overview "Recent activity" card):** still
  open the info drawer at bucket scope; unaffected. The Properties drawer has no
  entry point outside file menus, so it can't go stale on those pages.

## Testing

- Store unit tests: info-drawer `close()` clears `objectKey` but retains
  `prefix`; opening either drawer closes the other; properties store `open`
  sets a file scope and closes the info drawer.
- Component/interaction: file menu Properties opens the properties drawer (not
  the info drawer); file menu Activity opens the info drawer with the subject
  chip; ✕ on the chip returns to folder activity; toolbar buttons never show a
  file subject after a prior file action + close.
- Regression: Notes still folder-only; Versions tab still honors `objectKey`
  when set via the new menu item and the folder list otherwise.
