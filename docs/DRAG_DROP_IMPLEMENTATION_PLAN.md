# Cross-Panel Drag and Drop Implementation Plan

## Overview

This document outlines the implementation plan for adding drag-and-drop functionality to move/copy files between panels in the S3 Client application. The feature will allow users to drag files from one panel's file list and drop them into another panel to initiate a copy or move operation.

---

## Current State Analysis

### Existing Architecture

- **Panels**: Multi-pane split-view system with 1-3 columns, managed by `useLayoutStore`
- **File Lists**: Rendered via `FileList` → `FileRow` components with checkbox-based selection
- **Selection State**: Per-pane selection tracking in `useBrowserStore` using `Set<string>` for selected keys
- **Existing D&D**: File upload from desktop via `UploadZone` (window-level drag listeners)
- **Context**: `PaneContext` provides `paneId` and `activeTabId` to nested components

### Key Files to Modify

| File | Purpose |
|------|---------|
| `src/components/browser/file-row.tsx` | Add draggable behavior to rows |
| `src/components/browser/file-list.tsx` | Add drop zone behavior to list |
| `src/components/browser/file-browser.tsx` | Orchestrate drag state and handle drop operations |
| `src/lib/stores/browser-store.ts` | Add drag state management |
| `src/app/api/objects/copy/route.ts` | New API endpoint for copy operations |
| `src/app/api/objects/move/route.ts` | New API endpoint for move operations |

---

## UX Design Standards

### Drag Initiation

1. **Drag Handle vs Full Row**
   - Recommended: Full row draggable (more intuitive, matches Finder/Explorer behavior)
   - Visual indicator: Cursor changes to `grab` on hover, `grabbing` while dragging

2. **Multi-Select Drag**
   - If dragging a selected item → drag all selected items
   - If dragging an unselected item → drag only that item (and select it)
   - Show item count badge on drag preview when dragging multiple items

3. **Drag Preview**
   - Custom drag image showing:
     - File/folder icon
     - Item name (truncated if long)
     - Badge with count for multi-select (e.g., "3 items")

### Visual Feedback During Drag

1. **Source Panel**
   - Dragged items should have reduced opacity (0.5) while dragging
   - Clear visual distinction that items are being moved

2. **Target Panel/Drop Zone**
   - Highlight valid drop zones with colored border (blue/accent)
   - Show overlay indicator when hovering over valid target
   - Invalid drop targets should show "not-allowed" cursor
   - Folder rows should highlight as valid drop targets for nested drops

3. **Drop Zone States**
   | State | Visual |
   |-------|--------|
   | Default | No special styling |
   | Drag over (valid) | Blue border, light blue background tint |
   | Drag over (invalid) | Red/gray border, not-allowed cursor |
   | Drag over folder | Folder row highlighted as drop target |

### Drop Actions

1. **Modifier Keys for Copy vs Move**
   - Default action: **Copy** (safer, non-destructive)
   - Hold `Shift`: **Move** (delete source after successful copy)
   - Visual indicator showing current action during drag

2. **Drop Feedback**
   - Toast notification: "Copying 3 items to bucket/path..."
   - Progress indicator for large operations
   - Success/error toast on completion

3. **Conflict Resolution**
   - If file exists at destination:
     - Show dialog: "Replace", "Keep both" (rename), "Skip"
     - "Apply to all" checkbox for batch operations

---

## Technical Implementation

### Phase 1: Foundation (Drag State Management)

#### 1.1 Extend Browser Store

```typescript
// src/lib/stores/browser-store.ts

interface DragState {
  isDragging: boolean
  sourcePaneId: string | null
  sourceConnectionId: string | null
  sourceBucket: string | null
  sourcePath: string[]
  draggedItems: S3Object[]
}

interface BrowserState {
  // ... existing state
  dragState: DragState
}

interface BrowserActions {
  // ... existing actions
  startDrag: (paneId: string, connectionId: string, bucket: string, path: string[], items: S3Object[]) => void
  endDrag: () => void
}
```

#### 1.2 Create Drag Context

```typescript
// src/lib/contexts/drag-context.tsx

interface DragContextValue {
  isDragging: boolean
  draggedItems: S3Object[]
  sourcePaneId: string | null
  canDropInPane: (targetPaneId: string, targetPath: string[]) => boolean
}
```

### Phase 2: Draggable File Rows

#### 2.1 FileRow Drag Implementation

```tsx
// src/components/browser/file-row.tsx

const handleDragStart = (e: React.DragEvent) => {
  // Set drag data
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.setData('application/x-s3-objects', JSON.stringify({
    sourcePaneId,
    connectionId,
    bucket,
    path,
    items: selectedItems.has(object.key) ? Array.from(selectedItems) : [object.key]
  }))

  // Create custom drag image
  const dragPreview = createDragPreview(items)
  e.dataTransfer.setDragImage(dragPreview, 0, 0)

  // Update store
  startDrag(paneId, connectionId, bucket, path, items)
}

const handleDragEnd = () => {
  endDrag()
}
```

#### 2.2 Custom Drag Preview Component

```tsx
// src/components/browser/drag-preview.tsx

export function createDragPreview(items: S3Object[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'drag-preview'
  // Style with Tailwind classes via inline styles
  // Show icon, first item name, and count badge
  return el
}
```

### Phase 3: Drop Zones

#### 3.1 FileList Drop Zone

```tsx
// src/components/browser/file-list.tsx

const [isDragOver, setIsDragOver] = useState(false)
const { isDragging, sourcePaneId, canDropInPane } = useDragContext()

const isValidDropTarget = useMemo(() => {
  if (!isDragging || sourcePaneId === paneId) return false
  return canDropInPane(paneId, currentPath)
}, [isDragging, sourcePaneId, paneId, currentPath])

const handleDragOver = (e: React.DragEvent) => {
  if (!isValidDropTarget) return
  e.preventDefault()
  e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy'
  setIsDragOver(true)
}

const handleDrop = (e: React.DragEvent) => {
  e.preventDefault()
  const data = JSON.parse(e.dataTransfer.getData('application/x-s3-objects'))
  onDrop(data, e.shiftKey ? 'move' : 'copy')
}
```

#### 3.2 Folder Row as Drop Target

```tsx
// src/components/browser/file-row.tsx (for folders)

const handleFolderDragOver = (e: React.DragEvent) => {
  if (!object.isFolder) return
  if (!isValidDropTarget) return
  e.preventDefault()
  e.stopPropagation() // Prevent list-level handling
  setIsFolderDragOver(true)
}

const handleFolderDrop = (e: React.DragEvent) => {
  if (!object.isFolder) return
  e.preventDefault()
  e.stopPropagation()
  const data = JSON.parse(e.dataTransfer.getData('application/x-s3-objects'))
  onDrop(data, e.shiftKey ? 'move' : 'copy', object.key) // Pass folder path
}
```

### Phase 4: API Endpoints

#### 4.1 Copy Objects Endpoint

```typescript
// src/app/api/objects/copy/route.ts

export async function POST(request: Request) {
  const {
    sourceConnectionId,
    sourceBucket,
    sourceKeys,
    targetConnectionId,
    targetBucket,
    targetPath,
    conflictResolution // 'replace' | 'rename' | 'skip'
  } = await request.json()

  // Get both connections
  const sourceConn = await getConnection(sourceConnectionId)
  const targetConn = await getConnection(targetConnectionId)

  // Create S3 clients
  const sourceClient = createS3Client(sourceConn)
  const targetClient = createS3Client(targetConn)

  const results = []
  for (const key of sourceKeys) {
    // Handle cross-account/cross-bucket copy
    // For same endpoint: use CopyObjectCommand
    // For different endpoints: download + upload stream
    results.push(await copyObject(sourceClient, targetClient, ...))
  }

  return NextResponse.json({ results })
}
```

#### 4.2 Move Objects Endpoint

```typescript
// src/app/api/objects/move/route.ts

export async function POST(request: Request) {
  // Same as copy, but delete source after successful copy
  const copyResult = await copyObjects(...)
  if (copyResult.success) {
    await deleteObjects(sourceClient, sourceBucket, sourceKeys)
  }
  return NextResponse.json({ results })
}
```

### Phase 5: Progress & Feedback

#### 5.1 Transfer Progress Store

```typescript
// src/lib/stores/transfer-store.ts

interface TransferItem {
  id: string
  sourceKey: string
  targetKey: string
  operation: 'copy' | 'move'
  status: 'pending' | 'in-progress' | 'completed' | 'error'
  progress: number
  error?: string
}

interface TransferState {
  transfers: TransferItem[]
  addTransfer: (items: TransferItem[]) => void
  updateProgress: (id: string, progress: number) => void
  completeTransfer: (id: string) => void
  failTransfer: (id: string, error: string) => void
}
```

#### 5.2 Transfer Progress UI

```tsx
// src/components/browser/transfer-progress.tsx

// Similar to upload progress list
// Shows active transfers with progress bars
// Displays in corner/bottom of screen
```

### Phase 6: Conflict Resolution Dialog

```tsx
// src/components/dialogs/conflict-dialog.tsx

interface ConflictDialogProps {
  conflictingFiles: string[]
  onResolve: (resolution: 'replace' | 'rename' | 'skip', applyToAll: boolean) => void
  onCancel: () => void
}

// Modal showing:
// - List of conflicting files
// - Radio buttons: Replace, Keep Both (rename), Skip
// - Checkbox: Apply to all conflicts
// - Cancel and Apply buttons
```

---

## Validation Rules

### Valid Drop Conditions

| Source | Target | Valid? | Notes |
|--------|--------|--------|-------|
| Same pane, same path | Same pane, same path | No | No-op |
| Same pane, same path | Same pane, different path | Yes | Move within bucket |
| Pane A | Pane B, same bucket | Yes | Copy/move within bucket |
| Pane A | Pane B, different bucket | Yes | Cross-bucket operation |
| Pane A | Pane B, different connection | Yes | Cross-connection operation |
| Files | Folder in target | Yes | Drop into folder |
| Folder | Same folder (nested) | No | Prevent recursive |

### Invalid Drop Scenarios

- Dropping onto the same location (no change)
- Dropping a folder into itself or its descendants
- Dropping onto a non-browser tab (e.g., bucket list)
- Dropping when connection is offline/unavailable

---

## Accessibility Considerations

1. **Keyboard Support**
   - `Ctrl+C` / `Cmd+C`: Copy selected items to clipboard
   - `Ctrl+X` / `Cmd+X`: Cut selected items
   - `Ctrl+V` / `Cmd+V`: Paste in current panel
   - `Delete` / `Backspace`: Delete selected items

2. **Screen Reader Support**
   - Announce drag start: "Dragging 3 items"
   - Announce drop zones: "Drop zone available"
   - Announce completion: "3 items copied to bucket/path"

3. **Focus Management**
   - Return focus to source after drop
   - Trap focus in conflict dialog

---

## Implementation Phases & Order

### Phase 1: Foundation (Priority: High)
- [ ] Extend browser store with drag state
- [ ] Create drag context provider
- [ ] Add drag state types

### Phase 2: Draggable Rows (Priority: High)
- [ ] Implement drag handlers on FileRow
- [ ] Create custom drag preview
- [ ] Handle multi-select drag

### Phase 3: Drop Zones (Priority: High)
- [ ] FileList as drop zone
- [ ] Folder rows as nested drop targets
- [ ] Visual feedback (borders, backgrounds)
- [ ] Cursor states

### Phase 4: API Endpoints (Priority: High)
- [ ] Create copy objects endpoint
- [ ] Create move objects endpoint
- [ ] Handle cross-connection transfers
- [ ] Stream large files

### Phase 5: Integration (Priority: High)
- [ ] Connect drag/drop to API calls
- [ ] Invalidate React Query caches
- [ ] Handle errors

### Phase 6: Progress & Feedback (Priority: Medium)
- [ ] Transfer progress store
- [ ] Progress UI component
- [ ] Toast notifications

### Phase 7: Conflict Resolution (Priority: Medium)
- [ ] Check for existing files before copy
- [ ] Conflict resolution dialog
- [ ] Apply resolution strategy

### Phase 8: Polish & Accessibility (Priority: Low)
- [ ] Keyboard shortcuts (cut/copy/paste)
- [ ] Screen reader announcements
- [ ] Animation/transitions
- [ ] Edge case handling

---

## Library Recommendations

### Option A: Native HTML5 Drag & Drop (Recommended)
- **Pros**: No dependencies, full control, already used for upload
- **Cons**: More boilerplate, cross-browser quirks
- **Best for**: This use case (consistent with existing upload D&D)

### Option B: @dnd-kit
- **Pros**: Accessible, performant, flexible
- **Cons**: Additional dependency, learning curve
- **Best for**: Complex drag scenarios with sortable lists

### Option C: react-beautiful-dnd
- **Pros**: Great UX out of box
- **Cons**: Deprecated/maintenance mode, opinionated
- **Best for**: Simple list reordering

### Recommendation

Use **Native HTML5 Drag & Drop** for consistency with the existing upload zone implementation. The codebase already handles drag events at the window level for file uploads, so extending this pattern to cross-panel transfers maintains consistency and avoids adding new dependencies.

---

## File Structure for New Components

```
src/
├── components/
│   └── browser/
│       ├── drag-preview.tsx       # Custom drag image generator
│       ├── drop-indicator.tsx     # Visual drop zone indicator
│       └── transfer-progress.tsx  # Transfer progress list
├── lib/
│   ├── contexts/
│   │   └── drag-context.tsx       # Drag state context
│   └── stores/
│       └── transfer-store.ts      # Transfer progress state
└── app/
    └── api/
        └── objects/
            ├── copy/
            │   └── route.ts       # Copy endpoint
            └── move/
                └── route.ts       # Move endpoint
```

---

## Testing Considerations

### Unit Tests
- Drag state store actions
- Validation rules (canDropInPane)
- API endpoint logic

### Integration Tests
- Drag from pane A to pane B
- Multi-select drag operations
- Conflict resolution flow

### E2E Tests
- Full drag-drop workflow
- Cross-connection transfers
- Error handling scenarios

---

## Estimated Complexity

| Phase | Complexity | Dependencies |
|-------|------------|--------------|
| 1. Foundation | Low | None |
| 2. Draggable Rows | Medium | Phase 1 |
| 3. Drop Zones | Medium | Phase 1, 2 |
| 4. API Endpoints | Medium | None |
| 5. Integration | Medium | Phase 2, 3, 4 |
| 6. Progress & Feedback | Low | Phase 5 |
| 7. Conflict Resolution | Medium | Phase 5 |
| 8. Polish | Low | All phases |

---

## Summary

This implementation plan provides a comprehensive approach to adding cross-panel drag and drop functionality. The recommended approach uses native HTML5 Drag & Drop APIs for consistency with the existing codebase, implements proper UX patterns with visual feedback and modifier keys for copy/move actions, and includes conflict resolution for a polished user experience.

The feature is broken into 8 phases that can be implemented incrementally, with the core functionality (Phases 1-5) delivering a working drag-drop experience, and later phases (6-8) adding polish and edge case handling.
