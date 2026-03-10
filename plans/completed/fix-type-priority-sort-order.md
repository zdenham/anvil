# Fix: Type priority sort order under worktrees

## Problem

Threads (and other low-priority items) can appear above files, PRs, changes, and terminals in the sidebar tree. The expected order under any worktree is:

1. Files
2. PR
3. Changes
4. Terminals
5. Everything else (threads, plans, folders)

There are **two bugs** in the sort comparator at `src/hooks/use-tree-data.ts:223-232`:

### Bug 1: `sortKey` unconditionally overrides type priority

The comparator checks `sortKey` first, before type priority:

```ts
children.sort((a, b) => {
  if (a.sortKey && b.sortKey) return a.sortKey < b.sortKey ? -1 : ...;
  if (a.sortKey && !b.sortKey) return -1;   // ← sortKey ALWAYS wins
  if (!a.sortKey && b.sortKey) return 1;     // ← sortKey ALWAYS wins
  // Type priority only reached when NEITHER has sortKey
  const pa = typePriority(a);
  ...
});
```

When a thread is drag-and-dropped, it gets a `sortKey` from `visualSettings`. The synthetic nodes (`files:*`, `changes:*`) never have a `sortKey` (see `buildFilesNode`/`buildChangesNodes` in `tree-node-builders.ts`). So the DnD'd thread unconditionally sorts above files/changes/PRs/terminals.

The existing test at line 670 even documents this as intentional:

```ts
it("DnD-positioned items (with sortKey) override type priority", ...)
```

### Bug 2: Terminal fallback priority equals "everything else"

```ts
const TYPE_SORT_PRIORITY = {
  files: 0,
  "pull-request": 1,
  changes: 2,
  terminal: 3,
};
function typePriority(node) {
  return TYPE_SORT_PRIORITY[node.type] ?? 3;  // ← fallback is ALSO 3
}
```

Threads, plans, and folders get fallback `3` — same as terminals. They tie on type priority and fall through to `createdAt` descending, so a newer thread beats an older terminal.

## Solution

### Fix the comparator to respect type-priority tiers first

Type priority should be the **first** sort dimension. Within the same priority tier, `sortKey` determines order. Within items that share a tier and have no `sortKey`, fall back to `createdAt` descending.

```ts
const TYPE_SORT_PRIORITY: Partial<Record<TreeItemType, number>> = {
  files: 0,
  "pull-request": 1,
  changes: 2,
  terminal: 3,
};

function typePriority(node: TreeItemNode): number {
  return TYPE_SORT_PRIORITY[node.type] ?? 99;  // ← push everything else below
}
```

New comparator:

```ts
children.sort((a, b) => {
  // 1. Type priority: operational items always above conversations
  const pa = typePriority(a);
  const pb = typePriority(b);
  if (pa !== pb) return pa - pb;

  // 2. Within same tier: sortKey items first, ordered lexicographically
  if (a.sortKey && b.sortKey) return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
  if (a.sortKey && !b.sortKey) return -1;
  if (!a.sortKey && b.sortKey) return 1;

  // 3. Both without sortKey: newest first
  return b.createdAt - a.createdAt;
});
```

### Update tests

The existing test "DnD-positioned items (with sortKey) override type priority" asserts the buggy behavior. It needs to be updated/removed and replaced with a test that verifies type priority is respected even when threads have sortKeys.

## Files to change

- `src/hooks/use-tree-data.ts` — fix `typePriority` fallback and reorder comparator
- `src/hooks/__tests__/use-tree-data.test.ts` — update "type-priority sorting" tests

## Phases

- [x] Fix the sort comparator and type priority fallback in `use-tree-data.ts`

- [x] Update tests to reflect correct behavior

- [ ] Manual verification that DnD still works within same-tier items

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---