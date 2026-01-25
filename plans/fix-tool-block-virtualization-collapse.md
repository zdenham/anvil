# Fix Tool Block Collapse on Virtualization

## Problem

Tool blocks (both `ToolUseBlock` and `BashToolBlock`) auto-collapse when users scroll away and back. This is caused by React Virtuoso's virtualization - when items scroll far enough off-screen, they get unmounted to save memory. When the user scrolls back, the components remount with their default state (`useState(false)` for `isExpanded`).

## Root Cause

1. **`tool-use-block.tsx:87`**: `const [isExpanded, setIsExpanded] = useState(false);`
   - No state persistence, always starts collapsed on remount

2. **`bash-tool-block.tsx:192`**: `const [isExpanded, setIsExpanded] = useState(false);`
   - Main expand state has no caching
   - Note: The output expand state (line 222-240) DOES have caching via `expandedOutputCache`

3. **`message-list.tsx:103`**: `overscan={200}` provides some buffer but can't prevent all unmounts

## Solution Options

### Option A: Cache expand state in component (like bash output caching)

Add a module-level cache similar to what's already done for bash output:

```typescript
// tool-use-block.tsx
const expandedStateCache = new Map<string, boolean>();

// In component:
const [isExpanded, setIsExpanded] = useState(() => {
  return expandedStateCache.get(id) ?? false;
});

useEffect(() => {
  if (isExpanded) {
    expandedStateCache.set(id, true);
  } else {
    expandedStateCache.delete(id);
  }
}, [isExpanded, id]);
```

**Pros:**
- Minimal changes, follows existing pattern from `bash-tool-block.tsx`
- Self-contained in each component

**Cons:**
- Multiple caches to manage
- Cache can grow unbounded (need size limits)

### Option B: Lift state to parent (centralized store)

Store all expand states in a React context or Zustand store at the thread level.

**Pros:**
- Single source of truth
- Easier to implement "collapse all" / "expand all" features

**Cons:**
- More architectural change
- Need to pass down setters or use context

### Option C: Increase Virtuoso overscan significantly

Increase `overscan` to prevent most unmounts.

**Pros:**
- Zero code changes to tool blocks

**Cons:**
- Defeats purpose of virtualization
- Memory usage increases significantly for long threads
- Doesn't actually solve the problem for very long threads

## Recommended Approach: Option A

Follow the existing pattern from `bash-tool-block.tsx` output caching. This is:
- Consistent with existing code patterns
- Minimal risk
- Easy to implement

## Implementation Steps

### Step 1: Add caching to `tool-use-block.tsx`

1. Add module-level cache with size limits
2. Initialize state from cache
3. Sync state changes to cache
4. Use tool ID as the cache key

### Step 2: Add caching to `bash-tool-block.tsx` main expand state

1. Add separate cache for main expand state (output expand already cached)
2. Follow same pattern as Step 1
3. Use tool ID as the cache key

### Step 3: Consider cache cleanup strategy

- Current bash output cache uses LRU-style eviction at MAX_CACHE_SIZE (200)
- Apply same approach to new caches
- Consider clearing cache when thread changes (optional optimization)

## Files to Modify

1. `src/components/thread/tool-use-block.tsx`
2. `src/components/thread/tool-blocks/bash-tool-block.tsx`

## Testing

1. Open a thread with multiple tool calls
2. Expand several tool blocks
3. Scroll far away (past the overscan buffer)
4. Scroll back - verify expanded state is preserved
5. Repeat with bash tool blocks specifically
6. Test with long threads to ensure cache eviction doesn't cause issues
