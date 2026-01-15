import { MessageSquare, Play, CheckCircle, AlertCircle, Pause, Search, Code, Eye } from "lucide-react";
import type { ThreadMetadata } from "@/entities/threads/types";

interface ThreadsListProps {
  threads: ThreadMetadata[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
}

/** Format agent type for display */
function formatAgentType(agentType: string): string {
  switch (agentType) {
    case "research":
      return "Research";
    case "execution":
      return "Execution";
    case "review":
      return "Review";
    default:
      return agentType.charAt(0).toUpperCase() + agentType.slice(1);
  }
}

/** Get icon for agent type */
function AgentTypeIcon({ agentType }: { agentType: string }) {
  switch (agentType) {
    case "research":
      return <Search size={12} className="text-secondary-400" />;
    case "execution":
      return <Code size={12} className="text-accent-400" />;
    case "review":
      return <Eye size={12} className="text-amber-400" />;
    default:
      return <MessageSquare size={12} className="text-surface-400" />;
  }
}

/**
 * List of threads displayed under the Threads tab.
 * Shows thread type (agentType) and status, allows selection.
 */
export function ThreadsList({ threads, activeThreadId, onSelect }: ThreadsListProps) {
  if (threads.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-surface-500 italic">
        No threads yet
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {threads.map((thread) => (
        <button
          key={thread.id}
          onClick={() => onSelect(thread.id)}
          className={`
            px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors
            ${activeThreadId === thread.id
              ? "bg-surface-700/30 text-surface-200"
              : "text-surface-400 hover:text-surface-300 hover:bg-surface-800/30"
            }
          `}
        >
          <AgentTypeIcon agentType={thread.agentType} />
          <span className="truncate flex-1">
            {formatAgentType(thread.agentType)}
          </span>
          <ThreadStatusIcon status={thread.status} />
        </button>
      ))}
    </div>
  );
}

function ThreadStatusIcon({ status }: { status: ThreadMetadata["status"] }) {
  switch (status) {
    case "running":
      return <Play size={12} className="text-accent-400 animate-pulse" />;
    case "completed":
      return <CheckCircle size={12} className="text-green-400" />;
    case "error":
      return <AlertCircle size={12} className="text-red-400" />;
    case "paused":
      return <Pause size={12} className="text-yellow-400" />;
    default:
      return <MessageSquare size={12} className="text-surface-500" />;
  }
}
