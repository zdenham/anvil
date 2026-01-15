import { FilePlus, FileEdit, FileMinus, FileSymlink, File } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileChange } from "@/lib/types/agent-messages";

interface FileChangeBlockProps {
  /** File path */
  path: string;
  /** Operation type */
  operation: FileChange["operation"];
  /** For renames, the original path */
  oldPath?: string;
  /** Callback when clicking to view diff */
  onClick?: (path: string) => void;
}

const OPERATION_CONFIG = {
  create: {
    icon: FilePlus,
    label: "Created",
    color: "text-green-400",
    bg: "bg-green-950/30",
    border: "border-green-500/30",
  },
  modify: {
    icon: FileEdit,
    label: "Modified",
    color: "text-accent-400",
    bg: "bg-accent-950/30",
    border: "border-accent-500/30",
  },
  delete: {
    icon: FileMinus,
    label: "Deleted",
    color: "text-red-400",
    bg: "bg-red-950/30",
    border: "border-red-500/30",
  },
  rename: {
    icon: FileSymlink,
    label: "Renamed",
    color: "text-yellow-400",
    bg: "bg-yellow-950/30",
    border: "border-yellow-500/30",
  },
};

/**
 * Compact file change notification.
 * Clicking navigates to the diff viewer tab.
 */
export function FileChangeBlock({
  path,
  operation,
  oldPath,
  onClick,
}: FileChangeBlockProps) {
  const config = OPERATION_CONFIG[operation] || {
    icon: File,
    label: "Changed",
    color: "text-muted-foreground",
    bg: "bg-zinc-900",
    border: "border-zinc-700",
  };

  const Icon = config.icon;

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  return (
    <button
      onClick={() => onClick?.(path)}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full text-left",
        "border transition-colors",
        config.bg,
        config.border,
        onClick && "hover:brightness-110 cursor-pointer"
      )}
      disabled={!onClick}
    >
      <Icon className={cn("h-4 w-4 shrink-0", config.color)} aria-hidden="true" />

      <span className="flex-1 min-w-0">
        {operation === "rename" && oldPath ? (
          <span className="flex flex-col gap-0.5">
            <span className="text-muted-foreground line-through truncate">
              {oldPath}
            </span>
            <span className={cn("truncate", config.color)}>{path}</span>
          </span>
        ) : (
          <span className="truncate block" title={path}>
            {filename}
          </span>
        )}
      </span>

      <span className={cn("text-xs font-medium", config.color)}>
        {config.label}
      </span>
    </button>
  );
}
