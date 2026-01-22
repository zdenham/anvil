import { FileText, GitCommit, FileDiff } from "lucide-react";
import { TabButton } from "./tab-button";
import { ThreadsList } from "./threads-list";
import type { ThreadMetadata } from "@/entities/threads/types";

export type WorkspaceTab = "overview" | "changes" | "git";

interface LeftMenuProps {
  taskTitle: string;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  fileChangeCount: number;
  commitCount?: number;
  threads: ThreadMetadata[];
  activeThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
}

/**
 * Left menu navigation for the workspace.
 * Contains title, tab navigation (Overview, Changes, Git), and always-visible thread list.
 */
export function LeftMenu({
  taskTitle,
  activeTab,
  onTabChange,
  fileChangeCount,
  commitCount,
  threads,
  activeThreadId,
  onThreadSelect,
}: LeftMenuProps) {
  return (
    <div className="w-48 h-full flex flex-col border-r border-surface-600 bg-surface-950">
      {/* Title at top */}
      <div className="px-3 py-3 border-b border-surface-700">
        <h2 className="text-sm font-medium text-surface-200 truncate font-mono">
          {taskTitle}
        </h2>
      </div>

      {/* Tab buttons */}
      <div className="flex flex-col">
        <TabButton
          active={activeTab === "overview"}
          onClick={() => onTabChange("overview")}
          icon={<FileText size={14} />}
        >
          Overview
        </TabButton>
        <TabButton
          active={activeTab === "changes"}
          onClick={() => onTabChange("changes")}
          badge={fileChangeCount > 0 ? fileChangeCount : undefined}
          icon={<FileDiff size={14} />}
        >
          Changes
        </TabButton>
        <TabButton
          active={activeTab === "git"}
          onClick={() => onTabChange("git")}
          badge={commitCount}
          icon={<GitCommit size={14} />}
        >
          Git
        </TabButton>
      </div>

      {/* Thread list - always visible */}
      <div className="flex-1 overflow-auto border-t border-surface-700 mt-2">
        <div className="px-3 py-2 text-xs font-medium text-surface-500 uppercase tracking-wide font-mono">
          Threads
        </div>
        <ThreadsList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={onThreadSelect}
        />
      </div>
    </div>
  );
}
