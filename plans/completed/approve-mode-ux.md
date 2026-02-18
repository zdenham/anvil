# Approve Mode UX Improvements

Fix three UX issues with the permission request block shown in approve mode for file edits.

## Phases

- [x] Show real diff in permission request block (reuse InlineDiffBlock)
- [x] Move permission block above quick actions
- [x] Replace Enter/Escape with arrow-key selection UI

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Current State

The `PermissionRequestBlock` (`src/components/permission/permission-request-block.tsx`) is shown pinned above the chat input when a Write/Edit tool needs approval. It currently:

1. **Shows a crude text diff** via `PermissionInputDisplay` — just red/green text lines, not the proper `InlineDiffBlock` component used by tool result blocks
2. **Renders below quick actions** in `ThreadInputSection` layout (QuickActions → PermissionBlock → Input → StatusBar)
3. **Uses Enter/Escape keyboard shortcuts** — Enter to approve, Escape to deny

## Changes

### Phase 1: Show real diff in permission request block

**Problem:** `PermissionInputDisplay` builds a simplistic text-based diff for Edit tools. The `InlineDiffBlock` component already exists and renders proper diffs with syntax coloring, line numbers, collapse regions, and a header — we should reuse it.

**Approach:**

In `PermissionRequestBlock`, for Write/Edit tool calls:
- Import and use `useToolDiff` hook (from `src/components/thread/use-tool-diff.ts`) to generate diff data from `request.toolInput`
- Render `InlineDiffBlock` with the generated diff data instead of `PermissionInputDisplay`
- Keep `PermissionInputDisplay` as fallback for non-file tools (Bash, Grep, etc.)

**Files:**
- `src/components/permission/permission-request-block.tsx` — replace `PermissionInputDisplay` with `InlineDiffBlock` for Write/Edit tools

### Phase 2: Move permission block above quick actions

**Problem:** Layout order in `ThreadInputSection` is QuickActions → Permission → Input. The permission block should be more prominent, above quick actions.

**Approach:**

In `ThreadInputSection`, swap the render order so permission block comes first:

```
PermissionRequestBlock (if pending)  ← moved up
QuickActionsPanel
ThreadInput
ThreadInputStatusBar
```

**Files:**
- `src/components/reusable/thread-input-section.tsx` — move the permission block JSX above `QuickActionsPanel`

### Phase 3: Replace Enter/Escape with arrow-key selection UI

**Problem:** Current keyboard UX uses Enter to approve and Escape to deny. This is unintuitive — you might accidentally approve or deny. Claude Code uses up/down arrow selection with an optional free-text input.

**Approach:**

Replace the two separate buttons with a selectable option list:
- Two options rendered vertically: "Approve" (selected by default) and "Deny"
- Up/Down arrow keys move selection between them
- Enter confirms the currently selected option
- Typing any character switches to a free-text "reason" input (for deny with reason), then Tab or Escape returns to option selection
- Visual: highlight the selected option with a distinct bg/border, dim the unselected one
- Remove the old Enter/Escape kbd hints, show arrow key hint instead

The component should auto-focus on mount (already does) and capture arrow keys. The selected state is local (`useState<number>(0)` where 0=approve, 1=deny).

**Files:**
- `src/components/permission/permission-request-block.tsx` — replace button row with selectable option list + arrow key handler
