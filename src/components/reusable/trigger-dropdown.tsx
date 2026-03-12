import { useEffect, useRef, type RefObject } from "react";
import {
  Loader2,
  FileCode,
  FileJson,
  FileText,
  File,
  Folder,
  FolderCode,
  Sparkles,
  User,
  Terminal,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { TriggerConfig, TriggerResult } from "@/lib/triggers/types";

export interface TriggerDropdownProps {
  isOpen: boolean;
  config: TriggerConfig;
  results: TriggerResult[];
  selectedIndex: number;
  isLoading?: boolean;
  error?: string | null;
  onSelectIndex: (index: number) => void;
  onActivate: (result: TriggerResult) => void;
  onClose: () => void;
  anchorRect: DOMRect;
  containerRef?: RefObject<HTMLElement>;
}

// File type icon mapping
const FILE_ICONS: Record<string, string> = {
  ts: "typescript",
  tsx: "react",
  js: "javascript",
  jsx: "react",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "sass",
  html: "html",
  py: "python",
  rs: "rust",
  go: "go",
};

function getFileIcon(extension: string) {
  const iconType = FILE_ICONS[extension.toLowerCase()];

  switch (iconType) {
    case "typescript":
    case "javascript":
    case "react":
      return <FileCode className="h-4 w-4 text-accent-400" />;
    case "json":
      return <FileJson className="h-4 w-4 text-amber-400" />;
    case "markdown":
      return <FileText className="h-4 w-4 text-surface-400" />;
    default:
      return <File className="h-4 w-4 text-surface-400" />;
  }
}

// Lucide icon mapping for skill sources
// Maps SOURCE_ICONS values to actual Lucide components
function getSkillIcon(iconName: string) {
  const iconClass = "h-4 w-4 text-secondary-400";
  switch (iconName) {
    case "folder":
      return <Folder className={iconClass} />;
    case "folder-code":
      return <FolderCode className={iconClass} />;
    case "sparkles":
      return <Sparkles className={iconClass} />;
    case "user":
      return <User className={iconClass} />;
    case "terminal":
      return <Terminal className={iconClass} />;
    default:
      return <File className="h-4 w-4 text-surface-400" />;
  }
}

// Get icon based on trigger type - file extensions vs Lucide icon names
function getResultIcon(icon: string | undefined) {
  if (!icon) return <File className="h-4 w-4 text-surface-400" />;

  // Check if it's a known Lucide icon name (used by skills)
  const lucideIcons = ["folder", "folder-code", "sparkles", "user", "terminal"];
  if (lucideIcons.includes(icon)) {
    return getSkillIcon(icon);
  }

  // Otherwise treat as file extension
  return getFileIcon(icon);
}

// Empty state messages
const EMPTY_STATES = {
  noQuery: "Type to search",
  noResults: "No results found",
  noRootPath: "No project selected",
  error: "Search error",
};

// Path truncation for long paths
function truncatePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path;

  const parts = path.split("/");
  const filename = parts.pop() || "";

  // Always show filename, truncate directories
  if (filename.length >= maxLength - 3) {
    return "..." + filename.slice(-(maxLength - 3));
  }

  let result = filename;
  for (let i = parts.length - 1; i >= 0 && result.length < maxLength - 6; i--) {
    result = parts[i] + "/" + result;
  }

  return ".../" + result;
}

// Dropdown positioning with boundary detection
function calculatePosition(
  anchorRect: DOMRect,
  dropdownHeight: number,
  containerRef?: RefObject<HTMLElement>
): { top?: number; bottom?: number; left: number; direction: "up" | "down" } {
  const viewportHeight = window.innerHeight;
  const containerBounds = containerRef?.current?.getBoundingClientRect();
  const bottomBoundary = containerBounds?.bottom ?? viewportHeight;

  const spaceBelow = bottomBoundary - anchorRect.bottom;
  const spaceAbove = anchorRect.top - (containerBounds?.top ?? 0);

  // Prefer below, but flip if not enough space
  if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
    return {
      top: anchorRect.bottom + 4,
      left: anchorRect.left,
      direction: "down",
    };
  }

  // Anchor bottom edge just above the input so dropdown grows upward
  return {
    bottom: viewportHeight - anchorRect.top + 4,
    left: anchorRect.left,
    direction: "up",
  };
}

export function TriggerDropdown({
  isOpen,
  config,
  results,
  selectedIndex,
  isLoading,
  error,
  onSelectIndex,
  onActivate,
  anchorRect,
  containerRef,
}: TriggerDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const selectedItem = listRef.current.children[selectedIndex] as HTMLElement;
      selectedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen) return null;

  const dropdownHeight = 300; // Max height
  const position = calculatePosition(anchorRect, dropdownHeight, containerRef);

  const renderContent = () => {
    if (error) {
      return (
        <div className="p-3 text-red-400 text-sm">
          {EMPTY_STATES.error}: {error}
        </div>
      );
    }

    if (isLoading && results.length === 0) {
      return (
        <div className="p-3 text-surface-400 text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Searching...
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="p-3 text-surface-400 text-sm">{EMPTY_STATES.noResults}</div>
      );
    }

    return results.map((result, index) => (
      <div
        key={result.id}
        id={`trigger-option-${index}`}
        role="option"
        aria-selected={index === selectedIndex}
        onClick={() => onActivate(result)}
        onMouseEnter={() => onSelectIndex(index)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 cursor-pointer",
          "text-sm text-surface-200",
          index === selectedIndex && "bg-surface-700"
        )}
      >
        {getResultIcon(result.icon)}
        <span className="flex-1 truncate font-medium">{result.label}</span>
        <span className="text-surface-500 text-xs truncate max-w-[200px]">
          {truncatePath(result.description)}
        </span>
        {result.secondaryLabel && (
          <span className="text-surface-500 text-xs shrink-0">
            {result.secondaryLabel}
          </span>
        )}
      </div>
    ));
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={`${config.name} suggestions`}
      aria-activedescendant={
        results.length > 0 ? `trigger-option-${selectedIndex}` : undefined
      }
      className={cn(
        "fixed z-50",
        "w-[450px] max-h-[300px] overflow-auto",
        "bg-surface-800 border border-surface-700 rounded-lg shadow-lg",
        "py-1"
      )}
      style={{
        ...(position.top !== undefined && { top: position.top }),
        ...(position.bottom !== undefined && { bottom: position.bottom }),
        left: position.left,
      }}
    >
      {renderContent()}
      {/* Live region for result count */}
      <div role="status" aria-live="polite" className="sr-only">
        {results.length} {results.length === 1 ? "result" : "results"} found
      </div>
    </div>
  );
}
