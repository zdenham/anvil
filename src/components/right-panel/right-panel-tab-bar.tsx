import { Search, FolderTree, GitCommitVertical, type LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RightPanelTab } from "@/hooks/use-right-panel";

const TAB_CONFIG: { tab: RightPanelTab; icon: LucideIcon; tooltip: string }[] = [
  { tab: "search", icon: Search, tooltip: "Search" },
  { tab: "files", icon: FolderTree, tooltip: "Files" },
  { tab: "changelog", icon: GitCommitVertical, tooltip: "Changelog" },
];

interface RightPanelTabBarProps {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
}

export function RightPanelTabBar({ activeTab, onTabChange }: RightPanelTabBarProps) {
  return (
    <div className="flex items-center justify-center gap-1 px-2 py-1.5 border-b border-surface-700">
      {TAB_CONFIG.map(({ tab, icon: Icon, tooltip }) => {
        const isActive = activeTab === tab;
        return (
          <Tooltip key={tab} content={tooltip} side="bottom">
            <button
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded transition-colors",
                isActive
                  ? "text-accent-400 bg-surface-800"
                  : "text-surface-500 hover:text-surface-200 hover:bg-surface-800",
              )}
            >
              <Icon size={14} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
