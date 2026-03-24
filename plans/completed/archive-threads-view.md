# Archive Threads View

Recover accidentally archived threads via a new "Archived Threads" pane accessible from the tree menu header dropdown.

## Context

Threads are easily archived (single hover-click + confirm) but there's no way to recover them. Archived threads already persist on disk at `~/.anvil/archive/threads/{id}/metadata.json` — we just need UI to list them and move them back.

## Phases

- [x] Add archive service method to list and unarchive threads
- [x] Create the archived threads content pane view
- [x] Add "Archived Threads" entry to the tree panel header dropdown
- [x] Wire up navigation so clicking the menu item opens the pane

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### 1. Archive Service — List & Unarchive

**File:** `src/entities/threads/service.ts`

Add two methods to `threadService`:

- **`listArchivedThreads()`** — Reads `archive/threads/` directory, loads each `metadata.json`, returns `ThreadMetadata[]` sorted by `updatedAt` descending (most recently archived first).
- **`unarchive(threadId: string)`** — Inverse of the existing `archive()` method:
  1. Copy `metadata.json` + `state.json` from `archive/threads/{id}/` back to `threads/{id}/`
  2. Remove the archive directory entry
  3. Add the thread back to the Zustand store
  4. Emit a `THREAD_UNARCHIVED` event (or reuse `THREAD_CREATED` if simpler)

### 2. Archived Threads Pane

**New content pane view type:**

```ts
// content-pane/types.ts
| { type: "archived-threads" }
```

**New component:** `src/components/content-pane/archived-threads-view.tsx`

Simple list layout:
- Header: "Archived Threads"
- Each row: thread title (first prompt, truncated) + `updatedAt` relative timestamp + "Unarchive" button
- Sorted by most recently archived (most recent `updatedAt`)
- Empty state: "No archived threads"
- On unarchive: remove from list optimistically, call `threadService.unarchive()`

No pagination needed initially — just load all archived thread metadata on mount.

### 3. Tree Panel Header Dropdown Entry

**File:** `src/components/tree-menu/tree-panel-header.tsx` (or wherever the three-dot / dropdown menu lives in the tree header)

Add a menu item:
- Label: "Archived Threads"
- Icon: `Archive` from lucide-react
- Action: `navigationService.navigateToView("archived-threads")` (or equivalent pane navigation)

### 4. Navigation Wiring

**File:** `src/stores/navigation-service.ts`

- Add handler for the new `"archived-threads"` view type
- ContentPane switch in `content-pane.tsx` needs a case for `type: "archived-threads"` rendering `ArchivedThreadsView`

## Non-Goals

- No search/filter within the archive (keep it simple)
- No permanent delete from archive
- No archiving of plans/terminals from this view
- No pagination — can add later if archive grows large
