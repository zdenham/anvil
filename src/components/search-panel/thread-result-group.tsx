/**
 * ThreadResultGroup
 *
 * Displays a single thread's content matches: collapsible header row with
 * MessageSquare icon, thread name, and match count. Indented match snippets underneath.
 */

import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { MatchLine } from "./match-line";
import type { ThreadContentMatch } from "@/lib/tauri-commands";

export interface ThreadGroup {
  threadId: string;
  name: string;
  matches: ThreadContentMatch[];
  isCollapsed: boolean;
}

interface ThreadResultGroupProps {
  group: ThreadGroup;
  query: string;
  caseSensitive: boolean;
  onToggle: () => void;
  onMatchClick: () => void;
}

export function ThreadResultGroup({
  group,
  query,
  caseSensitive,
  onToggle,
  onMatchClick,
}: ThreadResultGroupProps) {
  return (
    <div>
      {/* Thread header row */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-2 py-0.5 hover:bg-surface-800 text-left group"
      >
        {group.isCollapsed ? (
          <ChevronRight size={14} className="text-surface-500 shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-surface-500 shrink-0" />
        )}
        <MessageSquare size={14} className="text-purple-400 shrink-0" />
        <span className="text-xs text-surface-300 truncate flex-1">
          {group.name || "Untitled Thread"}
        </span>
        <span className="text-xs text-surface-500 shrink-0 ml-1">({group.matches.length})</span>
      </button>

      {/* Match snippets */}
      {!group.isCollapsed && (
        <div className="ml-5">
          {group.matches.map((match, i) => (
            <button
              key={`${match.matchIndex}-${i}`}
              onClick={onMatchClick}
              className="flex items-baseline w-full px-2 py-0.5 hover:bg-surface-800 text-left"
            >
              <MatchLine text={match.lineContent} query={query} caseSensitive={caseSensitive} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
