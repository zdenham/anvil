# Fix Tool Block Collapse on Virtualization

## Problem

Tool blocks (both `ToolUseBlock` and `BashToolBlock`) auto-collapse when users scroll away and back. This is caused by React Virtuoso's virtualization - when items scroll far enough off-screen, they get unmounted to save memory. When the user scrolls back, the components remount with their default state (`useState(false)` for `isExpanded`).

## Root Cause

1. **`tool-use-block.tsx:87`**: `const [isExpanded, setIsExpanded] = useState(false);`
   - No state persistence, always starts collapsed on remount

2. **`bash-tool-block.tsx:192`**: `const [isExpanded, setIsExpanded] = useState(false);`
   - Main expand state has no caching
   - Note: The output expand state (line 222-240) has caching via module-level `expandedOutputCache` Map

3. **`message-list.tsx:103`**: `overscan={200}` provides some buffer but can't prevent all unmounts

## Current State Caching (Module-Level Maps)

The codebase currently uses module-level Maps for caching:
- `bash-tool-block.tsx:26`: `const expandedOutputCache = new Map<string, boolean>();`
- `code-block.tsx`: Similar pattern with `expandedStateCache`

These work but have downsides:
- Scattered across multiple files
- No centralized control
- Harder to clear/reset
- Not consistent with the Zustand stores used elsewhere in the app

## Solution: Zustand Store

Create a centralized Zustand store for tool block UI state, following the pattern used in other stores like `quick-actions-store.ts`.

### Store Design

```typescript
// src/stores/tool-expand-store.ts
import { create } from 'zustand';

interface ThreadToolState {
  // Map of toolId -> isExpanded
  expandedTools: Record<string, boolean>;
  // Map of toolId -> isOutputExpanded (for bash blocks with long output)
  expandedOutputs: Record<string, boolean>;
}

interface ToolExpandState {
  // Map of threadId -> ThreadToolState
  threads: Record<string, ThreadToolState>;

  // Actions (all scoped by threadId)
  setToolExpanded: (threadId: string, toolId: string, expanded: boolean) => void;
  setOutputExpanded: (threadId: string, toolId: string, expanded: boolean) => void;
  isToolExpanded: (threadId: string, toolId: string) => boolean;
  isOutputExpanded: (threadId: string, toolId: string, defaultValue: boolean) => boolean;

  // Bulk operations (scoped by threadId)
  collapseAll: (threadId: string) => void;
  expandAll: (threadId: string) => void;
  clearThread: (threadId: string) => void;
}
```

### Benefits

1. **Single source of truth** - All expand state in one place
2. **Follows existing patterns** - Consistent with other Zustand stores in the codebase
3. **Enables future features** - Easy to add "collapse all" / "expand all"
4. **Testable** - Can reset store in tests
5. **DevTools support** - Zustand integrates with Redux DevTools

## Implementation Steps

### Step 1: Create the Zustand store

Create `src/stores/tool-expand-store.ts` with:
- `threads: Record<string, ThreadToolState>` - nested by thread ID
- Each thread has its own `expandedTools` and `expandedOutputs` records
- All actions take `threadId` as first parameter
- Bulk operations (`collapseAll`, `expandAll`, `clearThread`) scoped to thread

### Step 2: Thread context for tool blocks

Tool blocks need access to the current thread ID. Options:
- Pass `threadId` prop down through the component tree
- Use a React context for thread ID (if not already available)
- Check if thread ID is already available in existing context

### Step 3: Update `tool-use-block.tsx`

1. Import the store
2. Get `threadId` from props or context
3. Replace `useState(false)` with `useToolExpandStore(state => state.isToolExpanded(threadId, toolId))`
4. Replace `setIsExpanded` calls with `store.setToolExpanded(threadId, toolId, value)`

### Step 4: Update `bash-tool-block.tsx`

1. Import the store
2. Get `threadId` from props or context
3. Replace `useState(false)` for main expand with store selector
4. Replace `expandedOutputCache` Map usage with store's `isOutputExpanded`/`setOutputExpanded`
5. Remove module-level `expandedOutputCache` and related code

### Step 5: Update `code-block.tsx` (optional, for consistency)

1. Migrate `expandedStateCache` to the store if desired
2. Or keep separate if code blocks have different lifecycle needs

## Files to Modify

1. **Create**: `src/stores/tool-expand-store.ts`
2. **Modify**: `src/components/thread/tool-use-block.tsx`
3. **Modify**: `src/components/thread/tool-blocks/bash-tool-block.tsx`
4. **Optional**: `src/components/thread/code-block.tsx`

## Testing

1. Open a thread with multiple tool calls
2. Expand several tool blocks
3. Scroll far away (past the overscan buffer)
4. Scroll back - verify expanded state is preserved
5. Repeat with bash tool blocks specifically
6. Test bash output expand/collapse separately
7. Verify store can be inspected in React DevTools or Redux DevTools
