import { RefreshCw, X } from "lucide-react";

interface FileBrowserHeaderProps {
  rootPath: string;
  onRefresh: () => void;
  onClose: () => void;
}

/**
 * Static header bar for the file browser panel.
 * Shows the root directory name, a refresh button, and a close button.
 */
export function FileBrowserHeader({
  rootPath,
  onRefresh,
  onClose,
}: FileBrowserHeaderProps) {
  const rootName = rootPath.split("/").pop() ?? rootPath;

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-surface-700 min-h-[36px]">
      {/* Root directory label */}
      <div className="flex items-center min-w-0 flex-1 overflow-hidden text-xs">
        <span className="text-surface-200 truncate">{rootName}</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onRefresh}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Refresh directory"
          title="Refresh directory"
        >
          <RefreshCw size={12} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close file browser"
          title="Close file browser"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
