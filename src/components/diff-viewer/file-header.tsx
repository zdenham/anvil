import { memo } from "react";
import { ArrowRight, ChevronRight, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFileIconUrl } from "../file-browser/file-icons";
import { CopyButton } from "../ui/copy-button";
import { Tooltip } from "../ui/tooltip";
import type { ParsedDiffFile } from "./types";

interface FileHeaderProps {
  /** The parsed file metadata */
  file: ParsedDiffFile;
  /** Whether the file card content is collapsed */
  isCollapsed?: boolean;
  /** Callback to toggle collapse */
  onToggleCollapse?: () => void;
  /** Whether all regions are expanded (full file shown) */
  isFullFile?: boolean;
  /** Toggle show full file */
  onToggleFullFile?: () => void;
}

/**
 * File header component showing path, operation badge, and stats.
 */
export const FileHeader = memo(function FileHeader({
  file,
  isCollapsed,
  onToggleCollapse,
  isFullFile,
  onToggleFullFile,
}: FileHeaderProps) {
  const path = file.newPath ?? file.oldPath ?? "Unknown file";
  const isRename = file.type === "renamed" && file.oldPath;

  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 px-3 py-1.5 bg-surface-800 sticky top-0 z-10 rounded-t-lg border-b border-surface-700",
        onToggleCollapse && "cursor-pointer select-none",
      )}
      role={onToggleCollapse ? "button" : undefined}
      tabIndex={onToggleCollapse ? 0 : undefined}
      onClick={onToggleCollapse}
      onKeyDown={onToggleCollapse ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleCollapse();
        }
      } : undefined}
    >
      {/* Collapse chevron */}
      {onToggleCollapse && (
        <ChevronRight
          className={cn(
            "w-4 h-4 text-surface-400 transition-transform duration-150 flex-shrink-0",
            !isCollapsed && "rotate-90",
          )}
          aria-hidden="true"
        />
      )}

      {/* File icon */}
      <img
        src={getFileIconUrl((file.newPath ?? file.oldPath ?? "file").split("/").pop() ?? "file")}
        alt=""
        className="w-4 h-4 flex-shrink-0"
        aria-hidden="true"
      />

      {/* File path(s) */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {isRename ? (
          <>
            <span className="font-mono text-xs text-surface-400 truncate">
              {file.oldPath}
            </span>
            <ArrowRight className="w-4 h-4 text-surface-500 flex-shrink-0" aria-hidden="true" />
            <span className="font-mono text-xs text-surface-200 truncate">
              {file.newPath}
            </span>
          </>
        ) : (
          <span className="font-mono text-xs text-surface-200 truncate">
            {path}
          </span>
        )}
      </div>

      {/* Copy path — right next to file name */}
      <CopyButton text={path} label="Copy path" />

      {/* Show full file toggle */}
      {onToggleFullFile && (
        <Tooltip content={isFullFile ? "Show hunks only" : "Show full file"}>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFullFile(); }}
            className={cn(
              "p-1 hover:bg-zinc-700 rounded transition-opacity shrink-0",
              "opacity-0 group-hover:opacity-100",
              isFullFile && "opacity-100 text-accent-400",
            )}
            aria-label={isFullFile ? "Show hunks only" : "Show full file"}
          >
            <FileCode className="h-3.5 w-3.5 text-zinc-400" />
          </button>
        </Tooltip>
      )}

      {/* Operation badge — hide for "modified" since the diff itself shows it */}
      {file.type !== "modified" && (
        <OperationBadge type={file.type} similarity={file.similarity} />
      )}

      {/* Stats */}
      {(file.stats.additions > 0 || file.stats.deletions > 0) && (
        <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
          {file.stats.additions > 0 && (
            <span className="text-emerald-400">+{file.stats.additions}</span>
          )}
          {file.stats.deletions > 0 && (
            <span className="text-red-400">-{file.stats.deletions}</span>
          )}
        </div>
      )}
    </div>
  );
});

interface OperationBadgeProps {
  type: ParsedDiffFile["type"];
  similarity?: number;
}

function OperationBadge({ type, similarity }: OperationBadgeProps) {
  const { label, className } = getBadgeConfig(type, similarity);

  return (
    <span
      className={`px-2 py-0.5 text-xs rounded font-medium flex-shrink-0 ${className}`}
    >
      {label}
    </span>
  );
}

function getBadgeConfig(
  type: ParsedDiffFile["type"],
  similarity?: number
): { label: string; className: string } {
  switch (type) {
    case "added":
      return {
        label: "Added",
        className: "bg-emerald-500/20 text-emerald-400",
      };
    case "deleted":
      return {
        label: "Deleted",
        className: "bg-red-500/20 text-red-400",
      };
    case "modified":
      return {
        label: "Modified",
        className: "bg-amber-500/20 text-amber-400",
      };
    case "renamed":
      return {
        label: similarity === 100 ? "Renamed" : `Renamed (${similarity}%)`,
        className: "bg-accent-500/20 text-accent-400",
      };
    case "binary":
      return {
        label: "Binary",
        className: "bg-surface-500/20 text-surface-400",
      };
    default:
      return {
        label: "Changed",
        className: "bg-surface-500/20 text-surface-400",
      };
  }
}
