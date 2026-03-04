import { useCallback, useEffect, useState } from "react";
import { invoke } from "@/lib/invoke";
import { RefreshCw, Terminal } from "lucide-react";
import { MortLogo } from "@/components/ui/mort-logo";
import { Tooltip } from "@/components/ui/tooltip";
import { MenuDropdown } from "./menu-dropdown";
import { PathsInfoSchema } from "@/lib/types/paths";
import { threadService } from "@/entities/threads/service";
import { planService } from "@/entities/plans/service";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { logger } from "@/lib/logger-client";

interface TreePanelHeaderProps {
  /** Called when Settings is clicked */
  onSettingsClick: () => void;
  /** Called when Archive is clicked */
  onArchiveClick: () => void;
  /** Called when Terminal is clicked (optional - terminal integration) */
  onTerminalClick?: () => void;
  /** Called when user clicks "Show all workspaces" */
  onUnhideAll?: () => void;
  /** Whether any workspaces are hidden or pinned */
  hasHiddenOrPinned?: boolean;
}

/**
 * Header bar for the tree panel.
 * Lives inside the tree panel, not spanning the full window.
 * Contains: MORT logo + title, icon buttons for Settings, Terminal, New dropdown.
 */
export function TreePanelHeader({
  onSettingsClick,
  onArchiveClick,
  onTerminalClick,
  onUnhideAll,
  hasHiddenOrPinned,
}: TreePanelHeaderProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [appSuffix, setAppSuffix] = useState<string>("");

  useEffect(() => {
    invoke<unknown>("get_paths_info")
      .then((raw) => {
        const info = PathsInfoSchema.parse(raw);
        setAppSuffix(info.app_suffix);
      })
      .catch((err) => {
        logger.error("[TreePanelHeader] Failed to get paths info:", err);
      });
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      // Sync worktrees for all repositories to pick up any external changes
      const repos = repoService.getAll();
      await Promise.all(repos.map((repo) => worktreeService.sync(repo.name)));

      // Refresh the lookup store with updated worktree data
      await useRepoWorktreeLookupStore.getState().hydrate();

      // Refresh threads and plans
      await Promise.all([threadService.hydrate(), planService.hydrate()]);
    } catch (err) {
      logger.error("[TreePanelHeader] Refresh failed:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  return (
    <div data-testid="tree-panel-header" className="pl-3 pr-2 py-2 border-b border-surface-700 flex items-center gap-2.5">
      <MortLogo size={4} />
      <h1 className="font-semibold text-surface-100 font-mono text-sm">
        MORT{appSuffix ? ` ${appSuffix.toUpperCase()}` : ""}
      </h1>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        <Tooltip content="Refresh" side="bottom">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
          </button>
        </Tooltip>
        {onTerminalClick && (
          <Tooltip content="Terminal" side="bottom">
            <button
              onClick={onTerminalClick}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
            >
              <Terminal size={12} />
            </button>
          </Tooltip>
        )}
        <MenuDropdown
          onSettingsClick={onSettingsClick}
          onArchiveClick={onArchiveClick}
          onUnhideAll={onUnhideAll}
          hasHiddenOrPinned={hasHiddenOrPinned}
        />
      </div>
    </div>
  );
}
