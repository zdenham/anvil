import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FileCode, FilePlus, FileMinus, FileX2 } from "lucide-react";
import { cn } from "../../lib/utils";

export interface FileJumpItem {
  path: string;
  /** Operation type for icon display */
  type: "added" | "deleted" | "modified" | "renamed";
  /** Number of additions */
  additions: number;
  /** Number of deletions */
  deletions: number;
}

interface FileJumpDropdownProps {
  files: FileJumpItem[];
  currentFileIndex: number;
  onJumpToFile: (index: number) => void;
}

function getFileIcon(type: FileJumpItem["type"]) {
  switch (type) {
    case "added":
      return <FilePlus className="h-4 w-4 text-emerald-400" />;
    case "deleted":
      return <FileMinus className="h-4 w-4 text-red-400" />;
    case "renamed":
      return <FileX2 className="h-4 w-4 text-accent-400" />;
    default:
      return <FileCode className="h-4 w-4 text-amber-400" />;
  }
}

export function FileJumpDropdown({
  files,
  currentFileIndex,
  onJumpToFile,
}: FileJumpDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(currentFileIndex);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Reset focused index when opening
  useEffect(() => {
    if (isOpen) {
      setFocusedIndex(currentFileIndex);
    }
  }, [isOpen, currentFileIndex]);

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const focusedItem = listRef.current.children[focusedIndex] as HTMLElement;
      focusedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex, isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, files.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          onJumpToFile(focusedIndex);
          setIsOpen(false);
          buttonRef.current?.focus();
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          buttonRef.current?.focus();
          break;
        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusedIndex(files.length - 1);
          break;
      }
    },
    [isOpen, files.length, focusedIndex, onJumpToFile]
  );

  const handleSelect = (index: number) => {
    onJumpToFile(index);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  if (files.length === 0) return null;

  const currentFile = files[currentFileIndex];
  const fileName = currentFile?.path.split("/").pop() ?? "";

  return (
    <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
          "bg-surface-800 hover:bg-surface-700 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-surface-500",
          "max-w-[300px]"
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {currentFile && getFileIcon(currentFile.type)}
        <span className="truncate">{fileName}</span>
        <ChevronDown
          className={cn("h-4 w-4 text-surface-400 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={`file-option-${focusedIndex}`}
          className={cn(
            "absolute top-full left-0 mt-1 z-50",
            "w-[400px] max-h-[300px] overflow-auto",
            "bg-surface-800 border border-surface-700 rounded-lg shadow-lg",
            "py-1"
          )}
        >
          {files.map((file, index) => (
            <div
              key={file.path}
              id={`file-option-${index}`}
              role="option"
              aria-selected={index === currentFileIndex}
              onClick={() => handleSelect(index)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer",
                "text-sm text-surface-200",
                index === focusedIndex && "bg-surface-700",
                index === currentFileIndex && "font-medium"
              )}
            >
              {getFileIcon(file.type)}
              <span className="flex-1 truncate">{file.path}</span>
              <span className="flex items-center gap-2 text-xs tabular-nums">
                {file.additions > 0 && (
                  <span className="text-emerald-400">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-400">-{file.deletions}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
