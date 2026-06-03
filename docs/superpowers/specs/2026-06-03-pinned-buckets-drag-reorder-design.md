# Pinned Buckets Drag-and-Drop Reorder

**Date:** 2026-06-03
**Status:** Approved

## Summary

Allow users to reorder their pinned buckets in the sidebar via drag-and-drop. Order is persisted in the database. The drag handle is the left icon on each pinned item, which swaps from a database icon to a grip icon on hover.

---

## Data Layer

### Schema

Add `sortOrder` to the `Bookmark` model in `prisma/schema.prisma`:

```prisma
model Bookmark {
  // ...existing fields...
  sortOrder    Int        @default(0)
}
```

No data migration required. Existing rows default to `0` and sort correctly via the `createdAt` tiebreaker.

### Query Change

`listBookmarks()` in `src/lib/db/bookmarks.ts` changes its `orderBy` from:

```ts
orderBy: { createdAt: "desc" }
```

to:

```ts
orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }]
```

This preserves the current newest-first display for existing pins (all `sortOrder: 0`, sorted by `createdAt DESC`).

### New Pin Creation

No change needed. `sortOrder` defaults to `0`, so new pins naturally appear at the top of the list (lowest `sortOrder`, highest `createdAt`).

---

## API Layer

### New Route: `PATCH /api/bookmarks/reorder`

File: `src/app/api/bookmarks/reorder/route.ts`

**Request body:**
```ts
{ ids: string[] }  // full ordered list of bucket-pin bookmark IDs
```

**Behavior:**
1. Authenticate the user via the existing auth pattern.
2. Validate that all provided IDs belong to the authenticated user.
3. Run a `prisma.$transaction` that sets `sortOrder = index` for each ID.

**Response:** `200 OK` with the updated bookmarks, or `400`/`403` on validation failure.

### React Query Hook

Add `useReorderBookmarks()` to `src/lib/queries/bookmarks.ts`:

- Calls `PATCH /api/bookmarks/reorder`
- Applies an optimistic update immediately (reorders the local cache before server response)
- Invalidates `bookmarks` query key on settle (success or error) to sync server state

---

## UI Layer

### Dependencies

Add to `package.json`:
- `@dnd-kit/core`
- `@dnd-kit/sortable`

### Sidebar Changes (`src/components/shared/app-sidebar.tsx`)

Extract the pinned bucket list item into a `PinnedBucketItem` component (co-located in the sidebar file or a small separate file). Wrap the pinned list in `DndContext` + `SortableContext`:

```tsx
<DndContext onDragEnd={handleDragEnd}>
  <SortableContext items={bucketPins.map(p => p.id)} strategy={verticalListSortingStrategy}>
    {bucketPins.map(pin => <PinnedBucketItem key={pin.id} pin={pin} />)}
  </SortableContext>
  <DragOverlay>
    {activePin ? <PinnedBucketItem pin={activePin} isOverlay /> : null}
  </DragOverlay>
</DndContext>
```

`handleDragEnd` calls `useReorderBookmarks()` with the reordered ID array.

### `PinnedBucketItem` Component

Uses `useSortable(pin.id)` from dnd-kit. The `listeners` and `attributes` are applied **only** to the left icon element (not the whole row), so clicking the row still navigates normally.

**Hover behavior:** The row has a `group` Tailwind class. The left icon renders:
- `DatabaseIcon` by default (opacity-100 group-hover:opacity-0, absolute)
- `GripVerticalIcon` on hover (opacity-0 group-hover:opacity-100, absolute, cursor-grab)

Both icons occupy the same space via `relative`/`absolute` positioning so layout doesn't shift.

### Drag Overlay

A `DragOverlay` renders a copy of the dragged item at `opacity-90` while dragging is in progress, giving clear visual feedback.

### Keyboard Support

dnd-kit provides built-in keyboard sorting (arrow keys to reorder, Space/Enter to confirm drop) with no additional implementation required.

---

## Out of Scope

- Reordering folder pins (only bucket-level pins, `prefix === null`, are shown in the sidebar's Pinned section)
- Real-time sync across multiple open tabs (order syncs on next query refetch)
