/**
 * SearchPanel
 *
 * VS Code-style content search panel. Searches both file contents (via git grep)
 * and thread conversation content in parallel. Results are virtualized for
 * efficient rendering of large result sets.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { VirtualizedResults } from "./virtualized-results";
import { useSearch } from "./use-search";
import { SearchHeader, SearchInput, FileScope, FilterFields, SummaryBar, useWorktreeOptions } from "./search-controls";
import { useSearchState } from "@/stores/search-state";
import { useThreadStore } from "@/entities/threads/store";
import type { GrepMatch } from "@/lib/tauri-commands";

export interface SearchPanelProps {
  onClose: () => void;
  onNavigateToFile: (filePath: string, lineNumber: number, worktreePath: string, isPlan: boolean) => void;
  onNavigateToThread: (threadId: string) => void;
}

export function SearchPanel({ onClose, onNavigateToFile, onNavigateToThread }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Controls state
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(true);
  const [includePatterns, setIncludePatterns] = useState("");
  const [excludePatterns, setExcludePatterns] = useState("archive, *.lock, dist, build");

  // Worktree selection — default to the active thread's worktree
  const worktreeOptions = useWorktreeOptions();
  const activeThread = useThreadStore((s) => s.activeThreadId ? s.threads[s.activeThreadId] : undefined);
  const initialIdx = useMemo(() => {
    if (!activeThread || worktreeOptions.length === 0) return 0;
    const idx = worktreeOptions.findIndex(
      (opt) => opt.worktreeId === activeThread.worktreeId && opt.repoId === activeThread.repoId,
    );
    return idx >= 0 ? idx : 0;
  }, [worktreeOptions, activeThread?.repoId, activeThread?.worktreeId]);
  const [selectedWorktreeIdx, setSelectedWorktreeIdx] = useState(initialIdx);
  const selectedWorktree = worktreeOptions[selectedWorktreeIdx] ?? worktreeOptions[0];
  const worktreePath = selectedWorktree?.path ?? "";

  // Search execution
  const search = useSearch({ includeFiles, worktreePath, caseSensitive, includePatterns, excludePatterns });

  // Auto-focus on mount; deactivate search on unmount
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      useSearchState.getState().deactivateSearch();
    };
  }, []);

  // Re-focus input on repeated Cmd+Shift+F while panel is open
  useEffect(() => {
    const handleFocus = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleFocus);
    return () => document.removeEventListener("keydown", handleFocus);
  }, []);

  // Escape key: clear input or close panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (search.query) {
          search.setQuery("");
          inputRef.current?.focus();
        } else {
          onClose();
        }
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [search.query, onClose]);

  // Collapse/expand all
  const handleCollapseAll = useCallback(() => {
    search.setFileGroups((prev) => prev.map((g) => ({ ...g, isCollapsed: true })));
    search.setThreadGroups((prev) => prev.map((g) => ({ ...g, isCollapsed: true })));
  }, []);

  const handleExpandAll = useCallback(() => {
    search.setFileGroups((prev) => prev.map((g) => ({ ...g, isCollapsed: false })));
    search.setThreadGroups((prev) => prev.map((g) => ({ ...g, isCollapsed: false })));
  }, []);

  const handleFileMatchClick = useCallback((match: GrepMatch, filePath: string, isPlan: boolean, matchIndex: number) => {
    onNavigateToFile(filePath, match.lineNumber, worktreePath, isPlan);
    useSearchState.getState().activateSearch(search.query, matchIndex);
  }, [worktreePath, onNavigateToFile, search.query]);

  const handleThreadMatchClick = useCallback((threadId: string, matchIndex: number, snippet: string) => {
    onNavigateToThread(threadId);
    useSearchState.getState().activateSearch(search.query, matchIndex, snippet);
  }, [search.query, onNavigateToThread]);

  const handleToggleThread = useCallback((threadId: string) => {
    search.setThreadGroups((prev) =>
      prev.map((g) => g.threadId === threadId ? { ...g, isCollapsed: !g.isCollapsed } : g)
    );
  }, []);

  const handleToggleFile = useCallback((filePath: string) => {
    search.setFileGroups((prev) =>
      prev.map((g) => g.filePath === filePath ? { ...g, isCollapsed: !g.isCollapsed } : g)
    );
  }, []);

  // Summary counts
  const threadCount = search.threadGroups.length;
  const fileCount = search.fileGroups.length;
  const hasResults = threadCount > 0 || fileCount > 0;
  const hasQuery = search.query.length >= 2;
  const isTruncated = search.fileTruncated || search.threadTruncated;

  const emptyText = !hasQuery
    ? "Type to search files and threads"
    : search.isSearching && !hasResults
      ? "Searching..."
      : !hasResults
        ? "No results"
        : null;

  return (
    <div data-testid="search-panel" className="flex flex-col h-full">
      <SearchHeader onClose={onClose} />
      <SearchInput
        ref={inputRef}
        value={search.query}
        onChange={search.setQuery}
        caseSensitive={caseSensitive}
        onToggleCase={() => setCaseSensitive((v) => !v)}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((v) => !v)}
      />
      <FileScope
        includeFiles={includeFiles}
        onToggleInclude={() => setIncludeFiles((v) => !v)}
        worktreeOptions={worktreeOptions}
        selectedIdx={selectedWorktreeIdx}
        onSelectWorktree={setSelectedWorktreeIdx}
      />
      {showFilters && (
        <FilterFields
          includePatterns={includePatterns}
          excludePatterns={excludePatterns}
          onIncludeChange={setIncludePatterns}
          onExcludeChange={setExcludePatterns}
        />
      )}
      {hasQuery && (
        <SummaryBar
          threadCount={threadCount}
          fileMatchCount={search.totalFileMatches}
          fileCount={fileCount}
          onCollapseAll={handleCollapseAll}
          onExpandAll={handleExpandAll}
        />
      )}
      {emptyText ? (
        <EmptyState text={emptyText} />
      ) : (
        <VirtualizedResults
          threadGroups={search.threadGroups}
          fileGroups={search.fileGroups}
          query={search.query}
          caseSensitive={caseSensitive}
          isTruncated={isTruncated}
          onToggleThread={handleToggleThread}
          onToggleFile={handleToggleFile}
          onThreadMatchClick={handleThreadMatchClick}
          onFileMatchClick={handleFileMatchClick}
        />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-full text-surface-500 text-xs">
      {text}
    </div>
  );
}
