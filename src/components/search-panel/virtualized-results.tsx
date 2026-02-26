/**
 * VirtualizedResults
 *
 * Renders search results using @tanstack/react-virtual for efficient rendering
 * of large result sets. Flattens thread/file groups into a single virtual list
 * with header and match row types.
 */

import { useRef, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { getFileIconUrl } from "@/components/file-browser/file-icons";
import { MatchLine } from "./match-line";
import type { FileGroup } from "./file-result-group";
import type { ThreadGroup } from "./thread-result-group";
import type { GrepMatch, ThreadContentMatch } from "@/lib/tauri-commands";

const HEADER_HEIGHT = 24;
const MATCH_HEIGHT = 22;
const OVERSCAN = 15;

type FlatItem =
  | { type: "thread-header"; group: ThreadGroup }
  | { type: "thread-match"; group: ThreadGroup; match: ThreadContentMatch; matchIndex: number }
  | { type: "file-header"; group: FileGroup }
  | { type: "file-match"; group: FileGroup; match: GrepMatch; matchIndex: number };

interface VirtualizedResultsProps {
  threadGroups: ThreadGroup[];
  fileGroups: FileGroup[];
  query: string;
  caseSensitive: boolean;
  isTruncated: boolean;
  onToggleThread: (threadId: string) => void;
  onToggleFile: (filePath: string) => void;
  onThreadMatchClick: (threadId: string) => void;
  onFileMatchClick: (match: GrepMatch, filePath: string, isPlan: boolean) => void;
}

export function VirtualizedResults({
  threadGroups,
  fileGroups,
  query,
  caseSensitive,
  isTruncated,
  onToggleThread,
  onToggleFile,
  onThreadMatchClick,
  onFileMatchClick,
}: VirtualizedResultsProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const flatItems = useMemo(() => buildFlatItems(threadGroups, fileGroups), [threadGroups, fileGroups]);

  const estimateSize = useCallback(
    (index: number) => {
      const item = flatItems[index];
      return item.type === "thread-header" || item.type === "file-header" ? HEADER_HEIGHT : MATCH_HEIGHT;
    },
    [flatItems],
  );

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = flatItems[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <VirtualRow
                item={item}
                query={query}
                caseSensitive={caseSensitive}
                onToggleThread={onToggleThread}
                onToggleFile={onToggleFile}
                onThreadMatchClick={onThreadMatchClick}
                onFileMatchClick={onFileMatchClick}
              />
            </div>
          );
        })}
      </div>
      {isTruncated && (
        <div className="px-3 py-1.5 text-xs text-amber-400">
          Results truncated. Refine your search for more specific results.
        </div>
      )}
    </div>
  );
}

function VirtualRow({
  item,
  query,
  caseSensitive,
  onToggleThread,
  onToggleFile,
  onThreadMatchClick,
  onFileMatchClick,
}: {
  item: FlatItem;
  query: string;
  caseSensitive: boolean;
  onToggleThread: (threadId: string) => void;
  onToggleFile: (filePath: string) => void;
  onThreadMatchClick: (threadId: string) => void;
  onFileMatchClick: (match: GrepMatch, filePath: string, isPlan: boolean) => void;
}) {
  switch (item.type) {
    case "thread-header":
      return <ThreadHeaderRow group={item.group} onToggle={() => onToggleThread(item.group.threadId)} />;
    case "thread-match":
      return (
        <ThreadMatchRow
          match={item.match}
          query={query}
          caseSensitive={caseSensitive}
          onClick={() => onThreadMatchClick(item.group.threadId)}
        />
      );
    case "file-header":
      return <FileHeaderRow group={item.group} onToggle={() => onToggleFile(item.group.filePath)} />;
    case "file-match":
      return (
        <FileMatchRow
          match={item.match}
          query={query}
          caseSensitive={caseSensitive}
          onClick={() => onFileMatchClick(item.match, item.group.filePath, item.group.isPlan)}
        />
      );
  }
}

function ThreadHeaderRow({ group, onToggle }: { group: ThreadGroup; onToggle: () => void }) {
  const Chevron = group.isCollapsed ? ChevronRight : ChevronDown;
  return (
    <button onClick={onToggle} className="flex items-center gap-1 w-full px-2 py-0.5 hover:bg-surface-800 text-left group">
      <Chevron size={14} className="text-surface-500 shrink-0" />
      <MessageSquare size={14} className="text-purple-400 shrink-0" />
      <span className="text-xs text-surface-300 truncate flex-1">{group.name || "Untitled Thread"}</span>
      <span className="text-xs text-surface-500 shrink-0 ml-1">({group.matches.length})</span>
    </button>
  );
}

function ThreadMatchRow({
  match,
  query,
  caseSensitive,
  onClick,
}: {
  match: ThreadContentMatch;
  query: string;
  caseSensitive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-baseline w-full ml-4 px-2 py-0.5 hover:bg-surface-800 text-left overflow-hidden min-w-0"
    >
      <MatchLine text={match.lineContent} query={query} caseSensitive={caseSensitive} />
    </button>
  );
}

function FileHeaderRow({ group, onToggle }: { group: FileGroup; onToggle: () => void }) {
  const Chevron = group.isCollapsed ? ChevronRight : ChevronDown;
  const filename = group.filePath.split("/").pop() ?? "";
  return (
    <button onClick={onToggle} className="flex items-center gap-1 w-full px-2 py-0.5 hover:bg-surface-800 text-left group">
      <Chevron size={14} className="text-surface-500 shrink-0" />
      <img src={getFileIconUrl(filename)} alt="" className="w-3.5 h-3.5 shrink-0" />
      <span className="text-xs text-surface-300 truncate flex-1">{group.filePath}</span>
      <span className="text-xs text-surface-500 shrink-0 ml-1">({group.matches.length})</span>
    </button>
  );
}

function FileMatchRow({
  match,
  query,
  caseSensitive,
  onClick,
}: {
  match: GrepMatch;
  query: string;
  caseSensitive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-baseline gap-2 w-full ml-4 px-2 py-0.5 hover:bg-surface-800 text-left overflow-hidden min-w-0"
    >
      <span className="text-xs text-surface-500 shrink-0 w-8 text-right tabular-nums">{match.lineNumber}</span>
      <MatchLine text={match.lineContent} query={query} caseSensitive={caseSensitive} />
    </button>
  );
}

function buildFlatItems(threadGroups: ThreadGroup[], fileGroups: FileGroup[]): FlatItem[] {
  const items: FlatItem[] = [];

  for (const group of threadGroups) {
    items.push({ type: "thread-header", group });
    if (!group.isCollapsed) {
      group.matches.forEach((match, matchIndex) => {
        items.push({ type: "thread-match", group, match, matchIndex });
      });
    }
  }

  for (const group of fileGroups) {
    items.push({ type: "file-header", group });
    if (!group.isCollapsed) {
      group.matches.forEach((match, matchIndex) => {
        items.push({ type: "file-match", group, match, matchIndex });
      });
    }
  }

  return items;
}
