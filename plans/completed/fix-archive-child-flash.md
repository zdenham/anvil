# Fix archive child flash

## Problem

When archiving a thread (or folder) that has children, the child briefly flashes at the worktree level before disappearing. The user sees the child "pop up" for one render frame before it gets archived.

## Root Cause

Two ordering issues in the archive flow:

### 1. Domain cascade in `threadService.archive()` archives parent first

In `src/entities/threads/service.ts:746-747`:
```javascript
const descendantIds = this.getDescendantThreadIds(threadId);
const allThreadIds = [threadId, ...descendantIds];
```

The parent is **first** in the array. The loop (line 758) processes each sequentially with `await` file I/O between iterations. Between the parent's `_applyDelete` and the child's `_applyDelete`, React can render. During that render, the child's `parentId` references a now-deleted node, causing `buildChildrenMap()` (use-tree-data.ts:106-112) to fall back to the worktree level — visible as a flash.

### 2. `cascadeArchive()` archives visual child threads parent-before-child

In `src/lib/cascade-archive.ts:206-214`, `descendants.threads` is iterated in depth-first order (parent before child, e.g. `[C, G]` for chain P->C->G). When thread C is archived, its own domain cascade runs `allThreadIds = [C, G]` — C is deleted before G, creating a render window where G's visual parent is gone.

Note: `cascadeArchive` already handles this correctly for folders (`descendants.folders.reverse()` on line 228) but not for threads or plans.

## Fix

### Phase 1: Reverse domain cascade order in `threadService.archive()`

**File:** `src/entities/threads/service.ts`

Change line 746-747 from:
```javascript
const allThreadIds = [threadId, ...descendantIds];
```
to:
```javascript
const allThreadIds = [...descendantIds.reverse(), threadId];
```

`getDescendantThreadIds()` returns a depth-first list (parent before children). Reversing gives us deepest-first order (children before parents), ensuring each thread's children are already gone from the store before it is removed. The parent thread itself goes last.

### Phase 2: Reverse visual cascade thread/plan order in `cascadeArchive()`

**File:** `src/lib/cascade-archive.ts`

Reverse `descendants.threads` and `descendants.plans` before iterating, matching the existing folder behavior:

```javascript
// 3. Threads — deepest first (matching folder convention)
for (const id of descendants.threads.reverse()) {
```

```javascript
// 4. Plans — deepest first
for (const id of descendants.plans.reverse()) {
```

This ensures that when `cascadeArchive` processes nested threads/plans, the deepest leaves are archived first, preventing any intermediate state where a child's visual parent is gone.

## Phases

- [x] Reverse domain cascade order in `threadService.archive()` (children first, parent last)
- [x] Reverse visual cascade thread/plan order in `cascadeArchive()` (deepest first)
- [x] Verify existing tests still pass, add test case for archive ordering

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Why this works

The `getDescendantThreadIds()` depth-first traversal produces `[C, G]` for chain `P -> C -> G`. Reversing gives `[G, C]`. With parent appended: `[G, C, P]`. Each entity's children are archived before it is, so no entity ever has a "broken" parentId reference during React renders.

This is the same pattern already used for folders in `cascadeArchive` (line 228: `descendants.folders.reverse()`).
