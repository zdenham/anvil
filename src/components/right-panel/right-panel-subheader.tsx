import { ChevronDown, RefreshCw } from "lucide-react";

export interface WorktreeOption {
  id: string;
  name: string;
  repoId: string;
  repoName: string;
  path: string;
}

interface RightPanelSubheaderProps {
  tabLabel: string;
  repoName: string | null;
  worktreeName: string | null;
  worktreeOptions: WorktreeOption[];
  onWorktreeChange: (worktreeId: string) => void;
  /** Optional refresh handler (shown only when provided) */
  onRefresh?: (() => void) | null;
}

function formatContextLabel(repoName: string | null, worktreeName: string | null): string | null {
  if (!repoName && !worktreeName) return null;
  if (repoName && worktreeName) return `${repoName} / ${worktreeName}`;
  return repoName ?? worktreeName;
}

export function RightPanelSubheader({
  tabLabel,
  repoName,
  worktreeName,
  worktreeOptions,
  onWorktreeChange,
  onRefresh,
}: RightPanelSubheaderProps) {
  const hasMultipleWorktrees = worktreeOptions.length > 1;
  const contextLabel = formatContextLabel(repoName, worktreeName);

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 min-h-[36px]">
      {/* Left: tab label */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium text-surface-300 shrink-0">{tabLabel}</span>
        {contextLabel && (
          <>
            <span className="text-xs text-surface-600">·</span>
            {hasMultipleWorktrees ? (
              <WorktreeDropdown
                currentWorktreeId={worktreeOptions.find((o) => o.name === worktreeName)?.id ?? ""}
                options={worktreeOptions}
                onChange={onWorktreeChange}
              />
            ) : (
              <span className="text-xs text-surface-500 truncate">{contextLabel}</span>
            )}
          </>
        )}
      </div>

      {/* Right: optional refresh button */}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors shrink-0"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      )}
    </div>
  );
}

function WorktreeDropdown({
  currentWorktreeId,
  options,
  onChange,
}: {
  currentWorktreeId: string;
  options: WorktreeOption[];
  onChange: (worktreeId: string) => void;
}) {
  return (
    <div className="relative flex items-center min-w-0">
      <select
        value={currentWorktreeId}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent text-xs text-surface-400 hover:text-surface-200 cursor-pointer outline-none pr-4 truncate min-w-0"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.repoName} / {opt.name}
          </option>
        ))}
      </select>
      <ChevronDown size={10} className="absolute right-0 pointer-events-none text-surface-500" />
    </div>
  );
}
