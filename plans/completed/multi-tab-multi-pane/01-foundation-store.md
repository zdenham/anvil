# 01 — Foundation Store

**Wave 1 (sequential)** — Blocks all other sub-plans.

## Goal

Create the `pane-layout` store, service, types, and Zod schemas that replace `content-panes/`. This is the data layer that every other sub-plan builds on.

## Context

**Replaces**: `src/stores/content-panes/` (store.ts, service.ts, types.ts)

**Existing patterns to follow**:
- `content-panes/store.ts` — Zustand store with `_apply*` optimistic methods returning `Rollback`
- `content-panes/service.ts` — Disk-as-truth service using `appData.readJson`/`writeJson`
- `content-panes/types.ts` — Zod schemas for persistence validation

**Persistence file**: `~/.anvil/ui/pane-layout.json` (new file, not migrating from `content-panes.json`)

## Files to Create

```
src/stores/pane-layout/
├── types.ts        — Zod schemas + runtime types (SplitNode, PaneGroup, TabItem, PaneLayoutState)
├── store.ts        — Zustand store with optimistic _apply* methods
├── service.ts      — Disk-as-truth service (hydrate, persist, CRUD for tabs/groups/splits)
└── constraints.ts  — Max split depth validation (4 wide, 3 high)
```

## Type Definitions (`types.ts`)

Define Zod schemas and inferred types for:

### SplitNode (recursive)
```typescript
type SplitNode =
  | { type: "leaf"; groupId: string }
  | { type: "split"; direction: "horizontal" | "vertical"; children: SplitNode[]; sizes: number[] };
```

### TabItem
```typescript
interface TabItem {
  id: string;           // UUID
  view: ContentPaneView;
}
```

### PaneGroup
```typescript
interface PaneGroup {
  id: string;           // UUID
  tabs: TabItem[];      // Ordered, max 5
  activeTabId: string;  // Currently visible tab within this group
}
```

### PaneLayoutPersistedState
```typescript
interface PaneLayoutPersistedState {
  root: SplitNode;
  groups: Record<string, PaneGroup>;
  activeGroupId: string;
}
```

Reuse the existing `ContentPaneViewSchema` from `content-panes/types.ts` for the view discriminated union inside `TabItem`. Don't duplicate it — import it.

## Store Actions (`store.ts`)

Zustand store with state + optimistic apply methods (same pattern as `content-panes/store.ts`):

**State**: `root`, `groups`, `activeGroupId`, `_hydrated`

**Actions** (all return `Rollback`):
- `hydrate(state)` — Set full state from disk
- `_applyOpenTab(groupId, tab, makeActive?)` — Add tab to group
- `_applyCloseTab(groupId, tabId)` — Remove tab, activate left neighbor
- `_applySetActiveTab(groupId, tabId)` — Switch active tab in group
- `_applySetTabView(groupId, tabId, view)` — Update a tab's view
- `_applyMoveTab(fromGroupId, tabId, toGroupId, index)` — Move tab between groups
- `_applyReorderTabs(groupId, tabIds)` — Reorder tabs within group
- `_applySetActiveGroup(groupId)` — Change focused group
- `_applyCreateGroup(group)` — Add a new group to the groups record
- `_applyRemoveGroup(groupId)` — Remove group from record
- `_applySplitGroup(groupId, direction, newGroup)` — Split a leaf into two
- `_applyUpdateSplitSizes(path, sizes)` — Update split ratios
- `_applyCollapseSplit(path)` — Remove a split node, promote remaining child

**Selectors** (exported functions, non-reactive):
- `getActiveGroup(): PaneGroup | null`
- `getActiveTab(): TabItem | null`
- `getVisibleThreadIds(): string[]` — All active tabs across all groups that show threads

## Service (`service.ts`)

Disk-as-truth service following `contentPanesService` pattern:

- `hydrate()` — Read `~/.anvil/ui/pane-layout.json`, validate with Zod, call `store.hydrate()`. On failure/missing, use default state.
- `persistState()` — Write current store state to disk (strip ephemeral fields like `autoFocus`)
- `openTab(view, groupId?)` — Create tab in group (or active group). Enforce max 5 (close leftmost if at cap). Persist + apply.
- `closeTab(groupId, tabId)` — Remove tab. Activate left neighbor. If group empty, remove group + collapse split. If last group, reset to default. Persist + apply.
- `setActiveTab(groupId, tabId)` — Persist + apply.
- `setActiveTabView(view)` — Update the active tab's view in the active group. Persist + apply.
- `moveTab(fromGroupId, tabId, toGroupId, index)` — Persist + apply.
- `setActiveGroup(groupId)` — Persist + apply.
- `splitGroup(groupId, direction, view?)` — Create new group, modify split tree. Persist + apply. Return new group ID.
- `updateSplitSizes(path, sizes)` — Persist + apply.
- `findOrOpenTab(view, options?)` — Search all groups for matching tab (by view type + ID). If found, focus it. If not, replace active tab (or open new if `options.newTab`).
- `getActiveGroup()` / `getActiveTab()` — Convenience wrappers.

## Default State

```typescript
const DEFAULT_GROUP_ID = crypto.randomUUID();
const DEFAULT_TAB_ID = crypto.randomUUID();

const DEFAULT_STATE: PaneLayoutPersistedState = {
  root: { type: "leaf", groupId: DEFAULT_GROUP_ID },
  groups: {
    [DEFAULT_GROUP_ID]: {
      id: DEFAULT_GROUP_ID,
      tabs: [{ id: DEFAULT_TAB_ID, view: { type: "empty" } }],
      activeTabId: DEFAULT_TAB_ID,
    },
  },
  activeGroupId: DEFAULT_GROUP_ID,
};
```

## Constraints (`constraints.ts`)

Export validation helpers:
- `canSplitHorizontal(root, groupId): boolean` — Walk tree, count consecutive horizontal splits on the path to `groupId`. Max 4 children per horizontal split.
- `canSplitVertical(root, groupId): boolean` — Same but vertical, max 3 children.
- `findGroupPath(root, groupId): number[]` — Returns index path from root to the leaf containing `groupId`.

## Tab Close Behavior

When closing a tab that is active:
1. If `index > 0`, activate `tabs[index - 1]` (left neighbor)
2. If `index === 0` and more tabs exist, activate `tabs[0]` (the new first tab)
3. If no tabs remain, remove the group and collapse the parent split
4. If the last group is removed, reset to default state (single empty group)

## Testing

Write unit tests for:
- Store `_apply*` methods (tab open/close/move, group create/remove, split/collapse)
- Service CRUD operations (mock disk)
- Tab close neighbor activation logic
- Split tree manipulation (split, collapse, find path)
- Constraint validation (max 4 wide, max 3 high)
- Default state generation
- Zod schema validation (valid and invalid payloads)

## Phases

- [x] Define Zod schemas and types in `types.ts`
- [x] Implement Zustand store with all `_apply*` methods in `store.ts`
- [x] Implement disk-as-truth service in `service.ts`
- [x] Implement constraint helpers in `constraints.ts`
- [x] Write unit tests for store, service, and constraints

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
