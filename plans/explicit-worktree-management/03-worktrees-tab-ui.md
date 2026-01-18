# Sub-Plan 3: Worktrees Tab UI

## Prerequisites
- **Sub-Plan 2 (Tauri Commands and Frontend Service)** must be complete

## Parallel Execution
Can run **in parallel with Sub-Plan 4** (Spotlight) after Sub-Plan 2 completes.

## Overview
Add a "Worktrees" tab to the main window where users can view, create, and delete worktrees.

---

## Part A: Add Tab to Navigation

### File: `src/components/main-window/main-window-layout.tsx`

1. Add "worktrees" to `TabId` type:
```typescript
export type TabId = "tasks" | "worktrees" | "logs" | "settings";
```

2. Add conditional rendering for WorktreesPage:
```typescript
{activeTab === "worktrees" && <WorktreesPage />}
```

### File: `src/components/main-window/sidebar.tsx`

Add worktrees to nav items:
```typescript
const navItems: NavItem[] = [
  { id: "tasks", label: "Tasks" },
  { id: "worktrees", label: "Worktrees" },  // NEW
  { id: "logs", label: "Logs" },
  { id: "settings", label: "Settings" },
];
```

---

## Part B: Worktrees Page Component

### New File: `src/components/main-window/worktrees-page.tsx`

```typescript
import { useState, useCallback, useEffect } from "react";
import { Plus, Trash2, GitBranch, Edit2 } from "lucide-react";
import { worktreeService } from "@/entities/worktrees";
import type { WorktreeState } from "@core/types/repositories";

// Import repository selection hook/context (check existing pattern)
// import { useSelectedRepository } from "@/entities/repositories";

export function WorktreesPage() {
  const [worktrees, setWorktrees] = useState<WorktreeState[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadWorktrees = useCallback(async () => {
    if (!selectedRepo) return;
    setLoading(true);
    setError(null);
    try {
      const list = await worktreeService.list(selectedRepo);
      setWorktrees(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worktrees");
    } finally {
      setLoading(false);
    }
  }, [selectedRepo]);

  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  const handleCreate = async () => {
    if (!selectedRepo || !newWorktreeName.trim()) return;
    setError(null);
    try {
      await worktreeService.create(selectedRepo, newWorktreeName.trim());
      setNewWorktreeName("");
      setShowCreateDialog(false);
      await loadWorktrees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create worktree");
    }
  };

  const handleDelete = async (name: string) => {
    if (!selectedRepo) return;
    // TODO: Check if worktree is in use by active tasks before deleting
    if (!confirm(`Delete worktree "${name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await worktreeService.delete(selectedRepo, name);
      await loadWorktrees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete worktree");
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-900">
      <header className="px-4 py-3 border-b border-surface-700/50 flex items-center gap-4">
        <h1 className="text-lg font-medium text-surface-100 font-mono">Worktrees</h1>

        {/* Repository selector - use existing pattern */}
        <RepoSelector value={selectedRepo} onChange={setSelectedRepo} />

        <div className="flex-1" />

        {/* Create button */}
        <button
          onClick={() => setShowCreateDialog(true)}
          disabled={!selectedRepo}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent-600 text-white rounded hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          New Worktree
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-surface-400 py-8">Loading...</div>
        ) : worktrees.length === 0 ? (
          <div className="text-center text-surface-400 py-8">
            {selectedRepo
              ? "No worktrees yet. Create one to get started."
              : "Select a repository to view worktrees."}
          </div>
        ) : (
          <div className="space-y-2">
            {worktrees.map((wt) => (
              <WorktreeRow
                key={wt.path}
                worktree={wt}
                onDelete={() => handleDelete(wt.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateWorktreeDialog
          name={newWorktreeName}
          onNameChange={setNewWorktreeName}
          onSubmit={handleCreate}
          onCancel={() => {
            setShowCreateDialog(false);
            setNewWorktreeName("");
          }}
        />
      )}
    </div>
  );
}

function WorktreeRow({
  worktree,
  onDelete,
}: {
  worktree: WorktreeState;
  onDelete: () => void;
}) {
  const lastAccessed = worktree.lastAccessedAt
    ? new Date(worktree.lastAccessedAt).toLocaleDateString()
    : "Never";

  return (
    <div className="flex items-center gap-3 p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors">
      <GitBranch size={16} className="text-surface-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="font-medium text-surface-100">{worktree.name}</div>
        <div className="text-sm text-surface-400 truncate">{worktree.path}</div>
        <div className="text-xs text-surface-500 mt-1">
          {worktree.currentBranch && (
            <span className="mr-3">Branch: {worktree.currentBranch}</span>
          )}
          <span>Last used: {lastAccessed}</span>
        </div>
      </div>

      <button
        onClick={onDelete}
        className="p-1.5 text-surface-400 hover:text-red-400 hover:bg-surface-700 rounded transition-colors"
        title="Delete worktree"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function CreateWorktreeDialog({
  name,
  onNameChange,
  onSubmit,
  onCancel,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      onSubmit();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-800 rounded-lg p-4 w-96 shadow-xl">
        <h2 className="text-lg font-medium text-surface-100 mb-4">New Worktree</h2>

        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Worktree name (e.g., feature-auth)"
          className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-surface-100 placeholder-surface-400 focus:outline-none focus:border-accent-500"
          autoFocus
        />

        <p className="text-xs text-surface-400 mt-2">
          Only letters, numbers, dashes, and underscores allowed.
        </p>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-surface-300 hover:text-surface-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!name.trim()}
            className="px-3 py-1.5 bg-accent-600 text-white rounded hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// TODO: Implement or import RepoSelector component
// This should match existing repository selection patterns in the codebase
function RepoSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (repo: string | null) => void;
}) {
  // Placeholder - implement based on existing patterns
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="px-2 py-1 bg-surface-700 border border-surface-600 rounded text-surface-100 text-sm"
    >
      <option value="">Select repository...</option>
      {/* TODO: Populate from repository list */}
    </select>
  );
}
```

---

## Verification Steps

1. Update `main-window-layout.tsx` with new tab type and conditional render
2. Update `sidebar.tsx` with worktrees nav item
3. Create `worktrees-page.tsx`
4. TypeScript compile: `pnpm tsc --noEmit`
5. Start dev server: `pnpm dev`
6. Navigate to Worktrees tab and verify:
   - Tab appears in sidebar
   - Repository selector works
   - Can create worktree
   - List shows worktrees
   - Can delete worktree

## Success Criteria
- "Worktrees" tab visible in sidebar
- Repository selector allows choosing a repo
- Create worktree dialog opens and creates worktree
- Worktree list displays with name, path, branch, last accessed
- Delete button removes worktree (with confirmation)
- Error messages display appropriately
