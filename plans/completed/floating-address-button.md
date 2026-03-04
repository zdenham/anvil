# Floating Address Comments Button

## Goal

Replace the per-file-header "Address" button with a single fixed-position floating button at the bottom-right of the screen. The button should display the total unresolved comment count across the entire diff and use bright white (accent) styling.

## Phases

- [x] Remove per-file Address button placements
- [x] Create floating button component
- [x] Mount floating button at content-pane level

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove per-file Address button placements

Remove the `AddressCommentsButton` from every place it currently renders per-file:

- **`diff-file-card.tsx`**: Remove the sticky-bottom `<AddressCommentsButton />` wrapper added below `DiffLinesWithComments`, and the import
- **`file-header.tsx`**: Remove `<FileHeaderAddressSlot />` from the header, the `FileHeaderAddressSlot` function, and the `AddressCommentsButton` import

Keep `address-comments-button.tsx` itself — we'll reuse its logic.

## Phase 2: Create floating button component

Create a new wrapper component `FloatingAddressButton` (in `src/components/diff-viewer/floating-address-button.tsx`) that:

- Reads `worktreeId` and `threadId` from `useDiffCommentStore`
- Subscribes to `useCommentStore` for the **total** unresolved count across the worktree (passing `threadId` so it respects context — thread view scopes to thread, changes view gets all)
- Renders a `fixed bottom-6 right-6 z-50` button with:
  - Bright white bg: `bg-accent-500 text-accent-900` (matching the gutter button fix)
  - `hover:bg-accent-400` for hover
  - Shadow for floating feel: `shadow-lg`
  - Icon (`MessageSquareWarning`) + label like "Address 3 comments"
  - `disabled` state while sending
- Reuses the existing click handler logic from `AddressCommentsButton` (resolve target thread, format prompt, send/resume)
- Returns `null` when `unresolvedCount === 0`

## Phase 3: Mount floating button at content-pane level

The button needs to be inside a `DiffCommentProvider` to access worktreeId/threadId. Two places already have providers:

1. **Thread view** (`content-pane.tsx:143`): `DiffCommentProvider` wraps both conversation and changes tabs — mount `FloatingAddressButton` inside this provider, but only show when `threadTab === "changes"` or always (comments apply to the worktree regardless of tab). Simplest: render unconditionally inside the provider.

2. **Changes view** (`changes-view.tsx:70`): `DiffCommentProvider` wraps the changes view — mount `FloatingAddressButton` inside this provider.

In both cases, place `<FloatingAddressButton />` as a sibling (not inside any scroll container) so `fixed` positioning works correctly. Since `fixed` is relative to the viewport, it will float above everything.

### Thread view (`content-pane.tsx`)

```tsx
<DiffCommentProvider worktreeId={activeMetadata.worktreeId} threadId={view.threadId}>
  {threadTab === "conversation" && <ThreadContent ... />}
  {threadTab === "changes" && <ChangesTab ... />}
  <FloatingAddressButton />
</DiffCommentProvider>
```

### Changes view (`changes-view.tsx`)

```tsx
<DiffCommentProvider worktreeId={worktreeId}>
  <div className="flex flex-col h-full">
    <SummaryHeader ... />
    <div className="flex-1 min-h-0">
      <ChangesDiffContent ... />
    </div>
  </div>
  <FloatingAddressButton />
</DiffCommentProvider>
```
