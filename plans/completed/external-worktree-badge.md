# External Worktree Badge & Visibility

Differentiate worktrees created inside Anvil ("internal") from those discovered via `git worktree list` during sync ("external"). External worktrees get a badge on their tree node and a global hide setting.

## Phases

- [x] Add `isExternal` field to WorktreeState schema and Rust struct

- [x] Set `isExternal` correctly in Rust worktree commands

- [x] Propagate `isExternal` through lookup store, WorktreeInfo, and tree nodes

- [x] Add "external" badge to worktree tree node

- [x] Add `hideExternalWorktrees` global setting with UI toggle

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add `isExternal` to WorktreeState schema

**Files:**

- `core/types/repositories.ts` — Add `isExternal: z.boolean().optional()` to `WorktreeStateSchema`
- `src-tauri/src/worktree_commands.rs` — Add `pub is_external: bool` to `WorktreeState` struct (with `#[serde(default)]`)

The field defaults to `false` (internal). Existing worktrees on disk without this field will deserialize as `false` via `#[serde(default)]` / `.optional().default(false)`.

## Phase 2: Set `isExternal` correctly in Rust commands

**Files:**

- `src-tauri/src/worktree_commands.rs`

`worktree_create` — Set `is_external: false` on the new `WorktreeState`. These are explicitly created by Anvil.

`worktree_sync` — When adding a new worktree discovered from git that doesn't exist in settings (the `!existing_paths.contains(&git_wt.path)` branch), set `is_external: true`. Existing entries keep their current `is_external` value.

The "main" worktree (source path) is a special case — it should also be `is_external: false` since it's the repo's own root.

## Phase 3: Propagate through lookup store, WorktreeInfo, and tree nodes

**Files:**

- `src/stores/repo-worktree-lookup-store.ts` — Add `isExternal: boolean` to `WorktreeLookupInfo`
- `src/hooks/use-tree-data.ts` — Add `isExternal` to `WorktreeInfo` interface
- `src/hooks/tree-node-builders.ts` — Pass `isExternal` onto the `TreeItemNode` in `worktreeToNode()`
- `src/stores/tree-menu/types.ts` — Add `isExternal?: boolean` to `TreeItemNode`

In `useRepoWorktreeLookupStore.hydrate()`, read `isExternal` from the worktree settings:

```ts
worktreeMap.set(wt.id, {
  name: wt.name,
  path: wt.path,
  currentBranch: wt.currentBranch ?? null,
  visualSettings: wt.visualSettings,
  isExternal: wt.isExternal ?? false,
});
```

In `useTreeData`, pass `isExternal` through `WorktreeInfo`:

```ts
result.push({
  worktreeId,
  repoId,
  repoName: repoInfo.name,
  worktreeName: wtInfo.name,
  worktreePath: wtInfo.path,
  visualSettings: wtInfo.visualSettings,
  isExternal: wtInfo.isExternal,
});
```

In `worktreeToNode()`, set `isExternal` on the node:

```ts
export function worktreeToNode(wt: WorktreeInfo): TreeItemNode {
  return {
    ...existing,
    isExternal: wt.isExternal,
  };
}
```

## Phase 4: Add "external" badge to worktree tree node

**Files:**

- `src/components/tree-menu/worktree-item.tsx`

In `WorktreeHeader`, after the worktree name span, render a small badge when `item.isExternal`:

```tsx
{item.isExternal && (
  <span
    className="ml-1 px-1 py-0.5 text-[10px] leading-none rounded bg-surface-700 text-surface-400"
    title="This worktree was not created by Anvil"
  >
    external
  </span>
)}
```

Place this right after the `<span>` that renders `item.worktreeName` (line \~206) and before the `isCreatingWorktree` loader.

## Phase 5: Add `hideExternalWorktrees` global setting

**Files:**

- `src/entities/settings/types.ts` — Add `hideExternalWorktrees: z.boolean().optional()` to `WorkspaceSettingsSchema`
- `src/entities/settings/store.ts` — Add `getHideExternalWorktrees()` selector
- `src/hooks/use-tree-data.ts` — Filter out external worktrees (and their children) when the setting is on
- `src/components/main-window/settings-page.tsx` — Add a toggle in a new or existing section

Default is `false` (show external worktrees). This is a **global** app-wide setting in `WorkspaceSettings`, not per-repository.

In `useTreeData`, subscribe to the setting and filter worktrees before building the tree:

```ts
const hideExternal = useSettingsStore(s => s.workspace.hideExternalWorktrees ?? false);

// In the useMemo, filter worktrees before passing to buildUnifiedTree:
const filteredWorktrees = hideExternal
  ? worktrees.filter(wt => !wt.isExternal)
  : worktrees;
```

Filtering at the `worktrees` input level (before `buildUnifiedTree`) ensures all child entities (threads, plans, terminals) under hidden external worktrees are also excluded, since Step 0b already filters entities whose `worktreeId` isn't in the known set.

For the settings UI, add a toggle in the settings page (e.g., under a "Sidebar" or "Tree" section, or in `RepositorySettings`):

```tsx
<SettingToggle
  label="Hide external worktrees"
  description="Hide worktrees not created by Anvil from the sidebar"
  checked={hideExternalWorktrees}
  onChange={toggleHideExternalWorktrees}
/>
```