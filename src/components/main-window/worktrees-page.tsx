import { useState, useCallback, useEffect, useRef } from "react";
import { Plus, Trash2, GitBranch, RefreshCw, Loader2, FolderGit2 } from "lucide-react";
import { Command } from "@tauri-apps/plugin-shell";
import { worktreeService } from "@/entities/worktrees";
import { useRepoStore } from "@/entities/repositories";
import type { WorktreeState } from "@core/types/repositories";
import { logger } from "@/lib/logger-client";

type WorktreesByRepo = Record<string, WorktreeState[]>;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, "-") // Replace spaces with dashes
    .replace(/[^a-z0-9\-_]/g, "") // Remove invalid characters
    .replace(/-+/g, "-"); // Collapse multiple dashes
}

function cleanSlug(input: string): string {
  return input.replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes
}

export function WorktreesPage() {
  const [worktreesByRepo, setWorktreesByRepo] = useState<WorktreesByRepo>({});
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForRepo, setCreateForRepo] = useState<string | null>(null);
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const repositoriesMap = useRepoStore((state) => state.repositories);
  const repositoryNames = Object.keys(repositoriesMap);

  // Sync worktrees from git for all repos
  const syncAllWorktrees = useCallback(async () => {
    if (repositoryNames.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const results: WorktreesByRepo = {};
      await Promise.all(
        repositoryNames.map(async (repoName) => {
          try {
            const synced = await worktreeService.sync(repoName);
            results[repoName] = synced;
          } catch (err) {
            logger.error(`[WorktreesPage] Failed to sync worktrees for ${repoName}:`, err);
            results[repoName] = [];
          }
        })
      );
      setWorktreesByRepo(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync worktrees");
    } finally {
      setLoading(false);
    }
  }, [repositoryNames.join(",")]);

  // Auto-sync on mount and when repos change
  useEffect(() => {
    syncAllWorktrees();
  }, [syncAllWorktrees]);

  const handleCreate = async () => {
    const cleanedName = cleanSlug(newWorktreeName);
    if (!createForRepo || !cleanedName) return;
    setError(null);
    try {
      await worktreeService.create(createForRepo, cleanedName);
      setNewWorktreeName("");
      setShowCreateDialog(false);
      setCreateForRepo(null);
      await syncAllWorktrees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create worktree");
    }
  };

  const handleDelete = async (repoName: string, worktreeName: string) => {
    logger.log(`[WorktreesPage] handleDelete called for worktree "${worktreeName}" in repo "${repoName}"`);
    setError(null);
    try {
      await worktreeService.delete(repoName, worktreeName);
      logger.log(`[WorktreesPage] Delete succeeded, syncing worktrees`);
      await syncAllWorktrees();
    } catch (err) {
      logger.error(`[WorktreesPage] Failed to delete worktree "${worktreeName}":`, err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openCreateDialog = (repoName: string) => {
    setCreateForRepo(repoName);
    setShowCreateDialog(true);
  };

  const totalWorktrees = Object.values(worktreesByRepo).reduce(
    (sum, wts) => sum + wts.length,
    0
  );

  return (
    <div className="flex flex-col h-full bg-surface-900">
      <header className="px-4 py-3 border-b border-surface-700/50 flex items-center gap-4">
        <h1 className="text-lg font-medium text-surface-100 font-mono">Worktrees</h1>

        <div className="flex-1" />

        {/* Refresh button */}
        <button
          onClick={syncAllWorktrees}
          disabled={loading}
          className="p-1.5 text-surface-400 hover:text-surface-300 disabled:opacity-50"
          title="Refresh worktrees"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
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
        ) : repositoryNames.length === 0 ? (
          <div className="text-center text-surface-400 py-8">
            No repositories configured.
          </div>
        ) : totalWorktrees === 0 && repositoryNames.length === 1 ? (
          <div className="text-center text-surface-400 py-8">
            No worktrees yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-6">
            {repositoryNames.map((repoName) => (
              <RepoSection
                key={repoName}
                repoName={repoName}
                worktrees={worktreesByRepo[repoName] || []}
                onDelete={(wtName) => handleDelete(repoName, wtName)}
                onCreateClick={() => openCreateDialog(repoName)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreateDialog && createForRepo && (
        <CreateWorktreeDialog
          repoName={createForRepo}
          name={newWorktreeName}
          onNameChange={setNewWorktreeName}
          onSubmit={handleCreate}
          onCancel={() => {
            setShowCreateDialog(false);
            setCreateForRepo(null);
            setNewWorktreeName("");
          }}
        />
      )}
    </div>
  );
}

function RepoSection({
  repoName,
  worktrees,
  onDelete,
  onCreateClick,
}: {
  repoName: string;
  worktrees: WorktreeState[];
  onDelete: (worktreeName: string) => Promise<void> | void;
  onCreateClick: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <FolderGit2 size={14} className="text-surface-400" />
        <h2 className="text-sm font-medium text-surface-300">{repoName}</h2>
        <span className="text-xs text-surface-500">({worktrees.length})</span>
        <div className="flex-1" />
        <button
          onClick={onCreateClick}
          className="p-1 text-surface-400 hover:text-surface-300 transition-colors"
          title={`New worktree for ${repoName}`}
        >
          <Plus size={14} />
        </button>
      </div>
      {worktrees.length === 0 ? (
        <div className="text-sm text-surface-500 pl-5">No worktrees</div>
      ) : (
        <div className="space-y-2">
          {worktrees.map((wt) => (
            <WorktreeRow
              key={wt.path}
              worktree={wt}
              onDelete={() => onDelete(wt.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorktreeRow({
  worktree,
  onDelete,
}: {
  worktree: WorktreeState;
  onDelete: () => Promise<void> | void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const openInCursor = async () => {
    try {
      logger.log(`[WorktreeRow] Opening worktree in Cursor`, {
        name: worktree.name,
        path: worktree.path,
      });

      const cmd = Command.create("open", ["-a", "Cursor", worktree.path], {});
      await cmd.execute();
      logger.log(`[WorktreeRow] Opened worktree "${worktree.name}" in Cursor`);
    } catch (err) {
      logger.error(`[WorktreeRow] Failed to open worktree in Cursor`, {
        name: worktree.name,
        path: worktree.path,
        error: err,
      });
    }
  };

  const lastAccessed = worktree.lastAccessedAt
    ? new Date(worktree.lastAccessedAt).toLocaleDateString()
    : "Never";

  // Click outside to cancel confirmation
  useEffect(() => {
    if (!confirming) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        logger.log(`[WorktreeRow] Click outside detected, cancelling confirmation for "${worktree.name}"`);
        setConfirming(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirming, worktree.name]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    logger.log(`[WorktreeRow] Delete button clicked for "${worktree.name}", confirming: ${confirming}, isDeleting: ${isDeleting}`);

    if (isDeleting) {
      logger.log(`[WorktreeRow] Already deleting, ignoring click`);
      return;
    }

    if (confirming) {
      logger.log(`[WorktreeRow] Confirmation click - starting deletion for "${worktree.name}"`);
      setIsDeleting(true);
      try {
        await onDelete();
        logger.log(`[WorktreeRow] onDelete completed for "${worktree.name}"`);
      } catch (error) {
        logger.error(`[WorktreeRow] Error during deletion of "${worktree.name}":`, error);
      } finally {
        setIsDeleting(false);
        setConfirming(false);
      }
    } else {
      logger.log(`[WorktreeRow] First click - showing confirmation for "${worktree.name}"`);
      setConfirming(true);
    }
  };

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
        onClick={openInCursor}
        className="px-2 py-1 rounded text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
        title="Open in Cursor"
      >
        open
      </button>

      {worktree.name !== "main" && (
        isDeleting ? (
          <span className="p-1.5 text-surface-500">
            <Loader2 size={14} className="animate-spin" />
          </span>
        ) : (
          <button
            ref={buttonRef}
            onClick={handleClick}
            className={`p-1.5 rounded transition-colors ${
              confirming
                ? "text-red-400 text-xs font-medium"
                : "text-surface-400 hover:text-red-400 hover:bg-surface-700"
            }`}
            title={confirming ? "Click again to confirm" : "Delete worktree"}
          >
            {confirming ? "Confirm" : <Trash2 size={14} />}
          </button>
        )
      )}
    </div>
  );
}

function CreateWorktreeDialog({
  repoName,
  name,
  onNameChange,
  onSubmit,
  onCancel,
}: {
  repoName: string;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slugified = slugify(e.target.value);
    onNameChange(slugified);
  };

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
        <h2 className="text-lg font-medium text-surface-100 mb-1">New Worktree</h2>
        <p className="text-sm text-surface-400 mb-4">for {repoName}</p>

        <input
          type="text"
          value={name}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Worktree name (e.g., feature-auth)"
          className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-surface-100 placeholder-surface-400 focus:outline-none focus:border-accent-500"
          autoFocus
        />

        <p className="text-xs text-surface-400 mt-2">
          Auto-formatted: only lowercase letters, numbers, dashes, and underscores.
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
            className="px-3 py-1.5 bg-surface-100 text-surface-900 font-medium rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

