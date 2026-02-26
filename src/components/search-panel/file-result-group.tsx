/**
 * FileResultGroup
 *
 * Displays a single file's grep results: collapsible header row with file icon,
 * relative path, and match count. Indented match lines underneath.
 * Plan files use a distinct icon and navigate to plan view on click.
 */

import { ChevronDown, ChevronRight, FileText, FileCheck } from "lucide-react";
import { MatchLine } from "./match-line";
import type { GrepMatch } from "@/lib/tauri-commands";

export interface FileGroup {
  filePath: string;
  matches: GrepMatch[];
  isPlan: boolean;
  isCollapsed: boolean;
}

interface FileResultGroupProps {
  group: FileGroup;
  query: string;
  caseSensitive: boolean;
  onToggle: () => void;
  onMatchClick: (match: GrepMatch) => void;
}

export function FileResultGroup({
  group,
  query,
  caseSensitive,
  onToggle,
  onMatchClick,
}: FileResultGroupProps) {
  const Icon = group.isPlan ? FileCheck : FileText;

  return (
    <div>
      {/* File header row */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-2 py-0.5 hover:bg-surface-800 text-left group"
      >
        {group.isCollapsed ? (
          <ChevronRight size={14} className="text-surface-500 shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-surface-500 shrink-0" />
        )}
        <Icon size={14} className={group.isPlan ? "text-blue-400 shrink-0" : "text-surface-400 shrink-0"} />
        <span className="text-xs text-surface-300 truncate flex-1">{group.filePath}</span>
        <span className="text-xs text-surface-500 shrink-0 ml-1">({group.matches.length})</span>
      </button>

      {/* Match lines */}
      {!group.isCollapsed && (
        <div className="ml-5">
          {group.matches.map((match, i) => (
            <button
              key={`${match.lineNumber}-${i}`}
              onClick={() => onMatchClick(match)}
              className="flex items-baseline gap-2 w-full px-2 py-0.5 hover:bg-surface-800 text-left"
            >
              <span className="text-xs text-surface-500 shrink-0 w-8 text-right tabular-nums">
                {match.lineNumber}
              </span>
              <MatchLine text={match.lineContent} query={query} caseSensitive={caseSensitive} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
