import type { TabId } from "./main-window-layout";
import { MortLogo } from "../ui/mort-logo";

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  isCollapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  id: TabId;
  label: string;
}

const navItems: NavItem[] = [
  { id: "inbox", label: "Mission Control" },
  { id: "worktrees", label: "Worktrees" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" },
];

export function Sidebar({ activeTab, onTabChange, isCollapsed }: SidebarProps) {
  if (isCollapsed) {
    return <div className="w-0 h-full" />;
  }

  return (
    <aside className="w-56 bg-surface-950 border-r border-surface-800 flex flex-col transition-all duration-300 ease-in-out">
      <div className="p-4 border-b border-surface-800 flex items-center gap-3">
        <MortLogo size={6} />
        <h1 className="text-lg font-semibold text-surface-100 font-mono">Mortician</h1>
      </div>
      <nav className="flex-1 p-2">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`
                w-full px-3 py-2 rounded-lg text-left font-medium font-mono
                transition-colors duration-150
                ${isActive
                  ? "bg-surface-800 text-surface-100"
                  : "text-surface-400 hover:bg-surface-800/50 hover:text-surface-300"
                }
              `}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
