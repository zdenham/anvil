# Inline Diff + Permission UI Cleanup

## Problem

Three UX issues in the current Edit tool permission flow:

1. **Redundant Accept/Reject footer** — The `InlineDiffActions` (Accept ✓ / Reject ✗ buttons) at the bottom of the inline diff block duplicates the Allow/Deny options below it. The user doesn't need two ways to approve/deny the same action.

2. **Insufficient padding above Allow/Deny** — The "Allow Edit?" prompt and its Allow/Deny radio options sit too tight against the diff block above.

3. **Redundant expanded dropdown + inline diff** — When a permission request arrives, `ToolPermissionWrapper` auto-expands the `EditToolBlock` dropdown (showing old_string/new_string boxes) AND renders `InlineDiffBlock` below it. Both show the same change. We should show the inline diff *inside* the edit tool dropdown instead, replacing the old_string/new_string view entirely.

## Phases

- [x] Phase 1: Remove InlineDiffActions footer from inline diff block
- [x] Phase 2: Move inline diff inside EditToolBlock and WriteToolBlock (replace old_string/new_string view when pending)
- [x] Phase 3: Add padding above the Allow/Deny UI
- [x] Phase 4: Clean up unused code

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove InlineDiffActions footer

**File:** `src/components/thread/inline-diff-block.tsx`

- Remove the `InlineDiffActions` render block (lines 222-228) — the `{!isFileCollapsed && isPending && ...}` section
- Remove `onAccept`, `onReject`, `isFocused` props from `InlineDiffBlockProps` since they're no longer consumed here
- Remove the `InlineDiffActions` import
- Keep `isPending` prop — still used for auto-collapse logic

**File:** `src/components/thread/inline-permission-approval.tsx`

- Remove `onAccept={handleApprove}` and `onReject={handleDeny}` from the `<InlineDiffBlock>` call (lines 134-135) since those props no longer exist

## Phase 2: Move inline diff inside EditToolBlock

The key change: when a permission is pending for an Edit, replace the old_string/new_string boxes inside the expanded dropdown with the proper `InlineDiffBlock`. This eliminates the redundancy of showing both.

**File:** `src/components/thread/tool-permission-wrapper.tsx`

- Stop rendering `<InlineDiffBlock>` inside `<InlinePermissionApproval>` — instead, pass `diffData` down to the children (the tool block) so it can render the diff internally
- Approach: Instead of rendering the diff in `InlinePermissionApproval`, the wrapper passes `diffData` and `isPending` to the `EditToolBlock` child. Since children are `ReactNode`, we'll use React's `cloneElement` or a context to pass the pending state to the child tool block.
- **Simpler approach:** Use a React context `ToolPermissionContext` to expose `{ isPending, diffData }` from the wrapper. `EditToolBlock` consumes it to conditionally swap its expanded content.

**New file:** `src/components/thread/tool-permission-context.tsx` (~15 lines)

```tsx
import { createContext, useContext } from "react";
import type { useToolDiff } from "./use-tool-diff";

interface ToolPermissionContextValue {
  isPending: boolean;
  diffData: ReturnType<typeof useToolDiff>;
}

const ToolPermissionContext = createContext<ToolPermissionContextValue | null>(null);

export const ToolPermissionProvider = ToolPermissionContext.Provider;
export function useToolPermission() {
  return useContext(ToolPermissionContext);
}
```

**File:** `src/components/thread/tool-permission-wrapper.tsx`

- Wrap `{children}` in `<ToolPermissionProvider value={{ isPending: true, diffData }}>` when pending
- Remove `diffData` prop from `<InlinePermissionApproval>` (it no longer renders the diff)

**File:** `src/components/thread/inline-permission-approval.tsx`

- Remove the `<InlineDiffBlock>` render entirely — the diff is now shown inside the tool block
- Remove `diffData` prop from `InlinePermissionApprovalProps`
- Remove the `InlineDiffBlock` import

**File:** `src/components/thread/tool-blocks/edit-tool-block.tsx`

- Import `useToolPermission` from the new context
- When `isPending` from context is true and `diffData` is available, render `<InlineDiffBlock>` in the expanded section instead of the old_string/new_string boxes
- When not pending (normal completed state), keep the existing old_string/new_string view
- This means the expanded content conditionally shows either:
  - **Pending:** `InlineDiffBlock` with proper unified diff view
  - **Completed:** Existing old_string/new_string colored boxes

## Phase 3: Add padding above Allow/Deny UI

**File:** `src/components/thread/inline-permission-approval.tsx`

- Increase top padding/margin on the permission container. Currently `className="outline-none py-1"` — change to `py-3` or `pt-3` to add more breathing room above the "Allow Edit?" text and options.

## Phase 4: Clean up

- Delete `src/components/thread/inline-diff-actions.tsx` entirely — no longer referenced anywhere after Phase 1 removed its usage from `InlineDiffBlock` and Phase 2 removed the diff from `InlinePermissionApproval`
- Verify no other files import `InlineDiffActions` (grep to confirm)
- Remove any now-unused imports across modified files
