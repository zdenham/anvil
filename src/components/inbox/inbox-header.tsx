import { PanelLeft, RefreshCw, Search } from "lucide-react";

interface InboxHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onToggleSidebar: () => void;
}

/**
 * Header component for Mission Control / Unified Inbox.
 *
 * Layout:
 * - Panel toggle button on left
 * - Search bar (max-w-xs)
 * - Spacer to push refresh right
 * - Refresh button on far right
 */
export function InboxHeader({
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing,
  onToggleSidebar,
}: InboxHeaderProps) {
  return (
    <header className="px-4 py-3 border-b border-surface-700/50 flex items-center gap-4">
      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 text-surface-400 hover:text-surface-300 hover:bg-surface-800/50 rounded transition-colors duration-150"
        title="Toggle sidebar"
      >
        <PanelLeft size={16} />
      </button>

      {/* Search */}
      <div className="relative flex-1 max-w-xs ml-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
        <input
          type="text"
          placeholder="Search threads and plans..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-7 pr-3 py-1 text-sm bg-surface-800/50 text-surface-100 placeholder:text-surface-500 focus:outline-none focus:bg-surface-800 transition-colors border-0 rounded"
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Refresh button */}
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="p-1.5 text-surface-400 hover:text-surface-300 disabled:opacity-50"
        title="Refresh"
      >
        <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
      </button>
    </header>
  );
}
