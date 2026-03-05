# Multi-Tab Visual Polish

Address visual feedback on the tab bar UI: tab separation, header height consistency, and new-tab behavior.

## Phases

- [x] Fix tab visual separation (add borders between tabs)
- [x] Match tab bar height to content pane headers
- [x] New tab creates a new thread in the MRU worktree

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix Tab Visual Separation

**Problem:** Tabs are hard to distinguish from each other. Active tab is `bg-surface-900` and inactive is `bg-surface-800` — too subtle, especially with no dividers.

**File:** `src/components/split-layout/tab-item.tsx`

**Changes:**
- Add a right border (`border-r border-surface-700`) to each tab item to create clear visual separation
- Consider a stronger bottom-border treatment on the active tab (e.g., a 2px accent bottom border on active, transparent on inactive) to make the selected state more obvious — similar to browser tab UIs
- Evaluate whether inactive tabs need slightly more contrast (e.g., `bg-surface-750` or `text-surface-300`)

## Phase 2: Match Tab Bar Height to Content Pane Headers

**Problem:** The tab bar uses `h-8` (32px fixed) while content pane headers use `px-3 py-2` (padding-based, ~36px). This mismatch is visually jarring.

**Files:**
- `src/components/split-layout/tab-bar.tsx` — tab bar container has `h-8`
- `src/components/content-pane/content-pane-header.tsx` — header uses `px-3 py-2`

**Changes:**
- Unify to the same height strategy. Two options:
  - **Option A (preferred):** Change tab bar from `h-8` to match the content pane header's effective height. Use `py-2` padding like the header, or increase to `h-9` to match
  - **Option B:** Set both to the same explicit `h-9` (36px)
- Verify the tab items within the bar still align properly after the height change
- Check the `+` button sizing still looks right at the new height

## Phase 3: New Tab Creates a New Thread in the MRU Worktree

**Behavior:** Clicking the `+` button should create a new thread scoped to the most recently used (MRU) worktree and open it in the new tab.

**Files to investigate:**
- `src/components/split-layout/tab-bar.tsx` — the `+` button click handler
- `src/entities/threads/service.ts` — thread creation logic
- `src/stores/repo-worktree-lookup-store.ts` — worktree tracking / MRU lookup

**Changes:**
- Wire the `+` button to call thread creation with the MRU worktree context
- Open the newly created thread in the new tab
- Focus the input field so the user can start typing immediately
