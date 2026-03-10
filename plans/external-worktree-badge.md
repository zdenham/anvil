# External Worktree Badge & Visibility

Differentiate worktrees created inside Mort ("internal") from those discovered via `git worktree list` during sync ("external"). External worktrees get a badge and an optional hide setting.

## Phases

- [ ] Add `isExternal` field to WorktreeState schema and Rust struct
- [ ] Set `isExternal` correctly in Rust worktree commands
- [ ] Propagate `isExternal` through frontend stores and tree data
- [ ] Add "external" badge to worktree section headers
- [ ] Add `hideExternalWorktrees` workspace setting with UI toggle

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `isExternal` to WorktreeState schema

**Files:**
- `core/types/repositories.ts` — Add `isExternal: z.boolean().optional()` to `WorktreeStateSchema`
- `src-tauri/src/worktree_commands.rs` — Add `pub is_external: bool` to `WorktreeState` struct (with `#[serde(default)]`)

The field defaults to `false` (internal). Existing worktrees on disk without this field will deserialize as `false` via `#[serde(default)]` / `.optional().default(false)`.

## Phase 2: Set `isExternal` correctly in Rust commands

**Files:**
- `src-tauri/src/worktree_commands.rs`

**`worktree_create`** — Set `is_external: false` on the new `WorktreeState`. These are explicitly created by Mort.

**`worktree_sync`** — When adding a new worktree discovered from git that doesn't exist in settings (the `!existing_paths.contains(&git_wt.path)` branch), set `is_external: true`. Existing entries keep their current `is_external` value.

The "main" worktree (source path) is a special case — it should also be `is_external: false` since it's the repo's own root.

## Phase 3: Propagate through frontend stores and tree data

**Files:**
- `src/stores/repo-worktree-lookup-store.ts` — Add `isExternal: boolean` to `WorktreeLookupInfo` interface
- `src/hooks/use-tree-data.ts` — Pass `isExternal` into `RepoWorktreeSection`
- `src/stores/tree-menu/types.ts` — Add `isExternal: boolean` to `RepoWorktreeSection` interface

In `useRepoWorktreeLookupStore.hydrate()`, read `isExternal` from the worktree settings:
```ts
worktreeMap.set(wt.id, {
  name: wt.name,
  path: wt.path,
  currentBranch: wt.currentBranch ?? null,
  isExternal: wt.isExternal ?? false,
});
```

In `buildTreeFromEntities`, add a lookup function parameter `getWorktreeIsExternal(repoId, worktreeId)` and set `isExternal` on each section.

## Phase 4: Add "external" badge to section headers

**Files:**
- `src/components/tree-menu/repo-worktree-section.tsx`

After the section title (`section.worktreeName`), render a small badge when `section.isExternal`:

```tsx
{section.isExternal && (
  <span
    className="ml-1 px-1 py-0.5 text-[10px] leading-none rounded bg-surface-700 text-surface-400"
    title="This worktree was not created by Mort"
  >
    external
  </span>
)}
```

Add `isExternal` to the `RepoWorktreeSectionProps` interface (it comes from `section.isExternal`).

## Phase 5: Add `hideExternalWorktrees` setting

**Files:**
- `src/entities/settings/types.ts` — Add `hideExternalWorktrees: z.boolean().optional()` to `WorkspaceSettingsSchema`
- `src/entities/settings/store.ts` — Add `getHideExternalWorktrees()` selector
- `src/hooks/use-tree-data.ts` — Filter out sections where `isExternal === true` when the setting is on
- Settings UI (existing settings page) — Add a toggle for "Hide external worktrees"

Default is `false` (show external worktrees). When enabled, the `useTreeData` hook filters out sections with `isExternal: true` during the pin/hide filtering step.

In `useTreeData`, subscribe to the setting and filter:
```ts
const hideExternal = useSettingsStore(s => s.workspace.hideExternalWorktrees ?? false);

// In the useMemo, add to the existing filtering:
let filtered = allSections;
if (hideExternal) {
  filtered = filtered.filter(s => !s.isExternal);
}
```
