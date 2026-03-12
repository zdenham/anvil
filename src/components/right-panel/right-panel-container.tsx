import { useState, useCallback, useMemo } from "react";
import type { RightPanelTab } from "@/hooks/use-right-panel";
import type { ActiveWorktreeContext } from "@/hooks/use-active-worktree-context";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { RightPanelTabBar } from "./right-panel-tab-bar";
import { RightPanelSubheader, type WorktreeOption } from "./right-panel-subheader";
import { ChangelogPanel } from "./changelog-panel";
import { FileBrowserPanel } from "@/components/file-browser/file-browser-panel";
import { SearchPanel } from "@/components/search-panel";

const TAB_LABELS: Record<RightPanelTab, string> = {
  search: "Search",
  files: "Files",
  changelog: "Changelog",
};

interface RightPanelContainerProps {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onClose: () => void;
  /** Auto-derived worktree context from active content pane */
  filesContext: ActiveWorktreeContext;
  /** Explicit worktree override from tree menu "Files" button */
  filesWorktreeOverride: { repoId: string; worktreeId: string; rootPath: string } | null;
  /** Search panel callbacks */
  onNavigateToFile: (filePath: string, lineNumber: number, worktreePath: string, isPlan: boolean) => void;
  onNavigateToThread: (threadId: string) => void;
}

export function RightPanelContainer({
  activeTab,
  onTabChange,
  onClose,
  filesContext,
  filesWorktreeOverride,
  onNavigateToFile,
  onNavigateToThread,
}: RightPanelContainerProps) {
  // Resolve worktree context: explicit override takes priority over auto-derived
  const worktreeRepoId = filesWorktreeOverride?.repoId ?? filesContext.repoId;
  const worktreeId = filesWorktreeOverride?.worktreeId ?? filesContext.worktreeId;
  const worktreeRootPath = filesWorktreeOverride?.rootPath ?? filesContext.workingDirectory;

  // Worktree name + options from lookup store
  const repos = useRepoWorktreeLookupStore((s) => s.repos);
  const worktreeName = useRepoWorktreeLookupStore((s) =>
    worktreeRepoId && worktreeId ? s.getWorktreeName(worktreeRepoId, worktreeId) : null,
  );

  const worktreeOptions = useMemo((): WorktreeOption[] => {
    const options: WorktreeOption[] = [];
    for (const [repoId, repo] of repos) {
      for (const [wtId, wt] of repo.worktrees) {
        options.push({ id: wtId, name: wt.name, repoId, repoName: repo.name, path: wt.path });
      }
    }
    return options;
  }, [repos]);

  const handleWorktreeChange = useCallback(
    (newWorktreeId: string) => {
      const opt = worktreeOptions.find((o) => o.id === newWorktreeId);
      if (!opt) return;
      // Update worktree override via tab change -- re-open files tab with new context
      onTabChange("files");
      // The filesWorktreeOverride is managed by the parent (MainWindowLayout),
      // but since we pass onTabChange which calls openTab, and we need to also
      // set the override, we dispatch a worktree change through openFileBrowser.
      // For now, we store a local override that takes priority.
      setLocalWorktreeOverride({ repoId: opt.repoId, worktreeId: opt.id, rootPath: opt.path });
    },
    [worktreeOptions, onTabChange],
  );

  // Local worktree override from sub-header dropdown (cleared on tab change)
  const [localWorktreeOverride, setLocalWorktreeOverride] = useState<{
    repoId: string; worktreeId: string; rootPath: string;
  } | null>(null);

  // Clear local override when tab changes away from the current context
  const handleTabChange = useCallback(
    (tab: RightPanelTab) => {
      setLocalWorktreeOverride(null);
      onTabChange(tab);
    },
    [onTabChange],
  );

  // Resolve final worktree context: local override > prop override > auto-derived
  const finalRepoId = localWorktreeOverride?.repoId ?? worktreeRepoId;
  const finalWorktreeId = localWorktreeOverride?.worktreeId ?? worktreeId;
  const finalRootPath = localWorktreeOverride?.rootPath ?? worktreeRootPath;
  const finalWorktreeName = useRepoWorktreeLookupStore((s) =>
    finalRepoId && finalWorktreeId ? s.getWorktreeName(finalRepoId, finalWorktreeId) : worktreeName,
  );
  const finalRepoName = useRepoWorktreeLookupStore((s) =>
    finalRepoId ? s.getRepoName(finalRepoId) : null,
  );

  // File browser refresh callback (registered by FileBrowserPanel)
  const [fileBrowserRefresh, setFileBrowserRefresh] = useState<(() => void) | null>(null);
  const handleRegisterRefresh = useCallback((refresh: () => void) => {
    setFileBrowserRefresh(() => refresh);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <RightPanelTabBar activeTab={activeTab} onTabChange={handleTabChange} />
      <RightPanelSubheader
        tabLabel={TAB_LABELS[activeTab]}
        repoName={finalRepoName}
        worktreeName={finalWorktreeName}
        worktreeOptions={worktreeOptions}
        onWorktreeChange={handleWorktreeChange}
        onRefresh={activeTab === "files" ? fileBrowserRefresh : null}
      />
      <div className={activeTab === "search" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <SearchPanel
          onClose={onClose}
          onNavigateToFile={onNavigateToFile}
          onNavigateToThread={onNavigateToThread}
        />
      </div>
      <div className={activeTab === "files" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        {finalRepoId && finalWorktreeId && finalRootPath ? (
          <FileBrowserPanel
            key={finalWorktreeId}
            rootPath={finalRootPath}
            repoId={finalRepoId}
            worktreeId={finalWorktreeId}
            onClose={onClose}
            onRegisterRefresh={handleRegisterRefresh}
          />
        ) : (
          <div className="flex items-center justify-center h-32 text-surface-500 text-sm">
            No worktree selected
          </div>
        )}
      </div>
      <div className={activeTab === "changelog" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
        <ChangelogPanel
          repoId={finalRepoId}
          worktreeId={finalWorktreeId}
          workingDirectory={finalRootPath}
        />
      </div>
    </div>
  );
}
