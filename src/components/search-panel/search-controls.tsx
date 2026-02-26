/**
 * Search Controls
 *
 * Header, input, file scope, filter fields, and summary bar
 * sub-components for the search panel.
 */

import { forwardRef, useMemo } from "react";
import { Search, X, Filter, CaseSensitive, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

export function SearchHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
      <span className="text-xs font-medium text-surface-300">Search</span>
      <button onClick={onClose} className="p-1 hover:bg-surface-800 rounded">
        <X size={12} className="text-surface-400" />
      </button>
    </div>
  );
}

export const SearchInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (v: string) => void;
  caseSensitive: boolean;
  onToggleCase: () => void;
  showFilters: boolean;
  onToggleFilters: () => void;
}>(({ value, onChange, caseSensitive, onToggleCase, showFilters, onToggleFilters }, ref) => (
  <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface-800">
    <Search size={14} className="text-surface-500 shrink-0" />
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search..."
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className="flex-1 bg-transparent text-xs text-surface-200 outline-none placeholder:text-surface-600"
    />
    <button
      onClick={onToggleCase}
      className={`p-1 rounded ${caseSensitive ? "bg-surface-700 text-surface-200" : "hover:bg-surface-800 text-surface-500"}`}
      title="Match Case"
    >
      <CaseSensitive size={14} />
    </button>
    <button
      onClick={onToggleFilters}
      className={`p-1 rounded ${showFilters ? "bg-surface-700 text-surface-200" : "hover:bg-surface-800 text-surface-500"}`}
      title="Toggle Filters"
    >
      <Filter size={14} />
    </button>
  </div>
));
SearchInput.displayName = "SearchInput";

export interface WorktreeOption {
  label: string;
  path: string;
  repoId: string;
  worktreeId: string;
}

export function FileScope({ includeFiles, onToggleInclude, worktreeOptions, selectedIdx, onSelectWorktree }: {
  includeFiles: boolean;
  onToggleInclude: () => void;
  worktreeOptions: WorktreeOption[];
  selectedIdx: number;
  onSelectWorktree: (idx: number) => void;
}) {
  const selected = worktreeOptions[selectedIdx] ?? worktreeOptions[0];
  const hasMultiple = worktreeOptions.length > 1;

  const parts = selected?.label.split("/") ?? [];
  const repoName = parts[0] ?? "";
  const worktreeName = parts.length > 1 ? parts.slice(1).join("/") : "";

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-800">
      <label className="flex items-center gap-1.5 text-xs text-surface-400 cursor-pointer shrink-0">
        <input type="checkbox" checked={includeFiles} onChange={onToggleInclude} className="rounded" />
        Files
      </label>
      {selected && (
        <div className="flex items-center gap-1 min-w-0 text-xs text-surface-500 truncate">
          <span className="truncate">{repoName}</span>
          {hasMultiple && worktreeName && (
            <>
              <span className="shrink-0">/</span>
              <select
                value={selectedIdx}
                onChange={(e) => onSelectWorktree(Number(e.target.value))}
                disabled={!includeFiles}
                className="bg-surface-900 text-surface-300 border border-surface-700 rounded px-1 py-0.5 min-w-0 disabled:opacity-50 text-xs"
              >
                {worktreeOptions.map((opt, i) => {
                  const wtName = opt.label.split("/").slice(1).join("/") || opt.label;
                  return <option key={opt.worktreeId} value={i}>{wtName}</option>;
                })}
              </select>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterFields({ includePatterns, excludePatterns, onIncludeChange, onExcludeChange }: {
  includePatterns: string;
  excludePatterns: string;
  onIncludeChange: (v: string) => void;
  onExcludeChange: (v: string) => void;
}) {
  return (
    <div className="px-3 py-1.5 border-b border-surface-800 space-y-1">
      <input
        type="text"
        value={includePatterns}
        onChange={(e) => onIncludeChange(e.target.value)}
        placeholder="files to include (e.g. *.ts, src/**)"
        className="w-full bg-surface-900 text-xs text-surface-300 border border-surface-700 rounded px-2 py-1 outline-none placeholder:text-surface-600"
      />
      <input
        type="text"
        value={excludePatterns}
        onChange={(e) => onExcludeChange(e.target.value)}
        placeholder="files to exclude"
        className="w-full bg-surface-900 text-xs text-surface-300 border border-surface-700 rounded px-2 py-1 outline-none placeholder:text-surface-600"
      />
    </div>
  );
}

export function SummaryBar({ threadCount, fileMatchCount, fileCount, onCollapseAll, onExpandAll }: {
  threadCount: number;
  fileMatchCount: number;
  fileCount: number;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}) {
  const parts: string[] = [];
  if (threadCount > 0) parts.push(`${threadCount} thread${threadCount !== 1 ? "s" : ""}`);
  if (fileMatchCount > 0) {
    parts.push(`${fileMatchCount} result${fileMatchCount !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`);
  }
  const summary = parts.join(", ") || "No results";

  return (
    <div className="flex items-center justify-between px-3 py-1 border-b border-surface-800">
      <span className="text-xs text-surface-500">{summary}</span>
      {(threadCount > 0 || fileCount > 0) && (
        <div className="flex items-center gap-0.5">
          <button onClick={onCollapseAll} className="p-0.5 hover:bg-surface-800 rounded" title="Collapse All">
            <ChevronsDownUp size={12} className="text-surface-500" />
          </button>
          <button onClick={onExpandAll} className="p-0.5 hover:bg-surface-800 rounded" title="Expand All">
            <ChevronsUpDown size={12} className="text-surface-500" />
          </button>
        </div>
      )}
    </div>
  );
}

export function useWorktreeOptions(): WorktreeOption[] {
  const repos = useRepoWorktreeLookupStore((s) => s.repos);

  return useMemo(() => {
    const options: WorktreeOption[] = [];
    for (const [repoId, repo] of repos) {
      for (const [worktreeId, wt] of repo.worktrees) {
        options.push({
          label: repo.worktrees.size > 1 ? `${repo.name}/${wt.name}` : repo.name,
          path: wt.path,
          repoId,
          worktreeId,
        });
      }
    }
    return options;
  }, [repos]);
}
