import { useEffect, useRef } from "react";
import { GitBranch } from "lucide-react";
import { SpotlightResult } from "./types";
import { ResultItem } from "./result-item";
import { AppIcon } from "./app-icon";
import { CalculatorIcon } from "./calculator-icon";
import { MortLogo } from "../ui/mort-logo";
import type { RepoWorktree } from "@core/types/repositories";
import { BUILTIN_MODES, type PermissionModeId } from "@core/types/permissions";

interface WorktreeInfo {
  repoWorktrees: RepoWorktree[];
  selectedWorktreeIndex: number;
  /** Number of distinct repositories in the list */
  repoCount: number;
}

const MODE_COLORS: Record<PermissionModeId, string> = {
  plan: "text-blue-400",
  implement: "text-green-400",
  approve: "text-amber-400",
};

interface ResultsTrayProps {
  results: SpotlightResult[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onActivate: (result: SpotlightResult) => void;
  worktreeInfo?: WorktreeInfo;
  permissionMode?: PermissionModeId;
}

const getResultKey = (result: SpotlightResult, index: number): string => {
  if (result.type === "app") {
    return `app-${result.data.path}-${index}`;
  }
  if (result.type === "thread") {
    return `thread-${result.data.query}-${index}`;
  }
  if (result.type === "action") {
    return `action-${result.data.action}-${index}`;
  }
  if (result.type === "file") {
    return `file-${result.data.path}-${index}`;
  }
  if (result.type === "history") {
    return `history-${result.data.timestamp}-${index}`;
  }
  return `calc-${result.data.displayExpression}-${index}`;
};

const getResultDisplay = (
  result: SpotlightResult,
  worktreeInfo?: WorktreeInfo,
  permissionMode?: PermissionModeId,
): { icon: React.ReactNode | null; title: React.ReactNode; subtitle: React.ReactNode } => {
  if (result.type === "file") {
    return {
      icon: null,
      title: result.data.path,
      subtitle: "",
    };
  }

  if (result.type === "history") {
    const draftIndicator = result.data.isDraft ? "-- " : "";
    const timeAgo = new Date(result.data.timestamp).toLocaleString();
    return {
      icon: <span className="text-2xl">{result.data.isDraft ? "--" : "---"}</span>,
      title: `${draftIndicator}${result.data.prompt}`,
      subtitle: result.data.isDraft ? `Draft from ${timeAgo}` : `Submitted ${timeAgo}`,
    };
  }

  if (result.type === "app") {
    return {
      icon: (
        <AppIcon
          iconPath={result.data.icon_path}
          appName={result.data.name}
          size={40}
        />
      ),
      title: result.data.name,
      subtitle: result.data.path,
    };
  }

  if (result.type === "thread") {
    // Build subtitle based on worktree state
    let subtitle: React.ReactNode = "Ask Mort to help with this";
    if (worktreeInfo) {
      const { repoWorktrees, selectedWorktreeIndex, repoCount } = worktreeInfo;
      const selected = repoWorktrees[selectedWorktreeIndex];
      if (selected) {
        // Show worktree name with icon and navigation hint if multiple worktrees exist
        const worktreeIcon = <GitBranch size={12} className="inline-block align-middle" />;
        const hint = repoWorktrees.length > 1 ? " · Tab to change" : "";
        // Always show repo/worktree format
        const displayName = `${selected.repoName} / ${selected.worktree.name}`;
        subtitle = (
          <span className="inline-flex items-center gap-1">
            {worktreeIcon}
            <span>{displayName}{hint}</span>
          </span>
        );
      } else if (repoWorktrees.length === 0) {
        // Distinguish between no repos configured vs no worktrees available
        if (repoCount === 0) {
          subtitle = "No repositories configured - add one in Settings";
        } else {
          subtitle = "No worktrees available - create one in Worktrees tab";
        }
      }
    }
    const modeId = permissionMode ?? "implement";
    const modeName = BUILTIN_MODES[modeId].name;
    const modeColor = MODE_COLORS[modeId];
    const title = (
      <span className="inline-flex items-center gap-1.5">
        Create thread
        <span className="text-surface-600">·</span>
        <span className={`${modeColor} font-mono text-xs`}>{modeName}</span>
        <span className="text-surface-500 font-mono text-[10px]">(shift+tab to cycle)</span>
      </span>
    );

    return {
      icon: <div className="w-10 h-10 flex items-center justify-center"><MortLogo size={7} /></div>,
      title,
      subtitle,
    };
  }

  if (result.type === "action") {
    if (result.data.action === "open-mort") {
      return {
        icon: <div className="w-10 h-10 flex items-center justify-center"><MortLogo size={7} /></div>,
        title: "Mort",
        subtitle: "Open the main window",
      };
    }
    if (result.data.action === "open-threads") {
      return {
        icon: <span className="text-3xl">📋</span>,
        title: "Threads",
        subtitle: "View all threads",
      };
    }
    if (result.data.action === "refresh") {
      return {
        icon: <span className="text-3xl">🔄</span>,
        title: "Refresh",
        subtitle: "Reload the current window (dev only)",
      };
    }
    return {
      icon: <span className="text-3xl">📁</span>,
      title: "Open Repository",
      subtitle: "Import a local folder as a repository",
    };
  }

  // Calculator result (result.type === "calculator")
  const { data } = result;
  return {
    icon: <CalculatorIcon size={40} />,
    title: data.isValid ? String(data.result) : "Invalid expression",
    subtitle: data.isValid
      ? "Press enter to copy result"
      : data.displayExpression,
  };
};

// Must match MAX_VISIBLE_RESULTS in src-tauri/src/panels.rs
const MAX_VISIBLE_RESULTS = 8;
const RESULT_ITEM_HEIGHT = 56; // h-14 = 56px
const RESULT_ITEM_HEIGHT_COMPACT = 32; // h-8 = 32px

export const ResultsTray = ({
  results,
  selectedIndex,
  onSelectIndex,
  onActivate,
  worktreeInfo,
  permissionMode,
}: ResultsTrayProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view when selection changes
  useEffect(() => {
    if (selectedRef.current && containerRef.current) {
      selectedRef.current.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      });
    }
  }, [selectedIndex]);

  if (results.length === 0) {
    return null;
  }

  // Determine if results are compact (file type results)
  const isCompact = results.length > 0 && results[0].type === "file";
  const itemHeight = isCompact ? RESULT_ITEM_HEIGHT_COMPACT : RESULT_ITEM_HEIGHT;
  const maxHeight = MAX_VISIBLE_RESULTS * itemHeight;
  const needsScroll = results.length > MAX_VISIBLE_RESULTS;

  return (
    <div
      ref={containerRef}
      data-testid="spotlight-results"
      className="rounded-b-xl bg-surface-900/80 backdrop-blur-xl overflow-y-auto"
      style={needsScroll ? { maxHeight } : undefined}
    >
      {results.map((result, index) => {
        // Only pass worktreeInfo and permissionMode to thread results
        const displayWorktreeInfo = result.type === "thread" ? worktreeInfo : undefined;
        const displayPermissionMode = result.type === "thread" ? permissionMode : undefined;
        const { icon, title, subtitle } = getResultDisplay(result, displayWorktreeInfo, displayPermissionMode);
        const isSelected = index === selectedIndex;
        return (
          <div key={getResultKey(result, index)} ref={isSelected ? selectedRef : undefined}>
            <ResultItem
              data-testid={`spotlight-result-${index}`}
              icon={icon}
              title={title}
              subtitle={subtitle}
              isSelected={isSelected}
              onSelect={() => onSelectIndex(index)}
              onActivate={() => onActivate(result)}
              compact={result.type === "file"}
            />
          </div>
        );
      })}
    </div>
  );
};
