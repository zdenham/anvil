import { SidebarCollapseButton } from "./sidebar-collapse-button";
import { TabButton } from "./tab-button";
import { ThreadsList } from "./threads-list";
import type { ThreadMetadata } from "@/entities/threads/types";

export type WorkspaceTab = "overview" | "changes" | "threads";

interface WorkspaceSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  fileChangeCount: number;
  threads: ThreadMetadata[];
  activeThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
}

/**
 * Collapsible tabbed sidebar for the workspace.
 * Contains Overview, Changes, and Threads tabs.
 * Starts collapsed on spotlight submission to maximize main content area.
 */
export function WorkspaceSidebar({
  isCollapsed,
  onToggleCollapse,
  activeTab,
  onTabChange,
  fileChangeCount,
  threads,
  activeThreadId,
  onThreadSelect,
}: WorkspaceSidebarProps) {
  return (
    <>
      {/* Apple-style collapse button - always visible */}
      <SidebarCollapseButton
        isCollapsed={isCollapsed}
        onClick={onToggleCollapse}
      />

      {!isCollapsed && (
        <div className="w-48 h-full flex flex-col border-r border-surface-700/50 bg-surface-900/30 pt-10">
          <TabButton
            active={activeTab === "overview"}
            onClick={() => onTabChange("overview")}
          >
            Overview
          </TabButton>
          <TabButton
            active={activeTab === "changes"}
            onClick={() => onTabChange("changes")}
            badge={fileChangeCount > 0 ? fileChangeCount : undefined}
          >
            Changes
          </TabButton>
          <TabButton
            active={activeTab === "threads"}
            onClick={() => onTabChange("threads")}
          >
            Threads
          </TabButton>

          {/* Thread list shown when threads tab is active */}
          {activeTab === "threads" && (
            <div className="flex-1 overflow-auto border-t border-surface-700/50 mt-1">
              <ThreadsList
                threads={threads}
                activeThreadId={activeThreadId}
                onSelect={onThreadSelect}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
