import { memo } from "react";
import {
  File,
  FilePlus,
  FileMinus,
  FileEdit,
  ArrowRight,
  FileQuestion,
} from "lucide-react";
import type { ParsedDiffFile } from "./types";

interface FileHeaderProps {
  /** The parsed file metadata */
  file: ParsedDiffFile;
}

/**
 * File header component showing path, operation badge, and stats.
 */
export const FileHeader = memo(function FileHeader({ file }: FileHeaderProps) {
  const path = file.newPath ?? file.oldPath ?? "Unknown file";
  const isRename = file.type === "renamed" && file.oldPath;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface-800 sticky top-0 z-10">
      {/* File icon */}
      <FileIcon type={file.type} className="w-4 h-4 flex-shrink-0" />

      {/* File path(s) */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {isRename ? (
          <>
            <span className="font-mono text-sm text-surface-400 truncate">
              {file.oldPath}
            </span>
            <ArrowRight className="w-4 h-4 text-surface-500 flex-shrink-0" aria-hidden="true" />
            <span className="font-mono text-sm text-surface-200 truncate">
              {file.newPath}
            </span>
          </>
        ) : (
          <span className="font-mono text-sm text-surface-200 truncate">
            {path}
          </span>
        )}
      </div>

      {/* Operation badge */}
      <OperationBadge type={file.type} similarity={file.similarity} />

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

interface FileIconProps {
  type: ParsedDiffFile["type"];
  className?: string;
}

function FileIcon({ type, className }: FileIconProps) {
  const iconClass = `${className} ${getFileIconColor(type)}`;

  switch (type) {
    case "added":
      return <FilePlus className={iconClass} aria-hidden="true" />;
    case "deleted":
      return <FileMinus className={iconClass} aria-hidden="true" />;
    case "modified":
      return <FileEdit className={iconClass} aria-hidden="true" />;
    case "renamed":
      return <ArrowRight className={iconClass} aria-hidden="true" />;
    case "binary":
      return <FileQuestion className={iconClass} aria-hidden="true" />;
    default:
      return <File className={iconClass} aria-hidden="true" />;
  }
}

function getFileIconColor(type: ParsedDiffFile["type"]): string {
  switch (type) {
    case "added":
      return "text-emerald-400";
    case "deleted":
      return "text-red-400";
    case "modified":
      return "text-amber-400";
    case "renamed":
      return "text-accent-400";
    default:
      return "text-surface-400";
  }
}

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
