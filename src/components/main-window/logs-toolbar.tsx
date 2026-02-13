import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Check, ChevronDown, Copy, Loader2, Search, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import type { LogEntry, LogFilter, LogLevel } from "@/entities/logs";
import { cn } from "@/lib/utils";

const levels: LogLevel[] = ["trace", "debug", "info", "warn", "error"];
const COPY_FEEDBACK_MS = 2000;

// Format log entries for copying to clipboard
function formatLogsForClipboard(logs: LogEntry[]): string {
  return logs
    .map((log) => {
      // Use ISO string and format manually to get milliseconds
      const date = new Date(log.timestamp);
      const time = date.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const ms = date.getMilliseconds().toString().padStart(3, "0");
      const level = log.level.toUpperCase().padEnd(5);
      return `[${time}.${ms}] [${level}] [${log.target}] ${log.message}`;
    })
    .join("\n");
}

const levelColors: Record<LogLevel, { active: string; inactive: string }> = {
  trace: {
    active: "bg-secondary-600 text-secondary-100",
    inactive: "bg-surface-800 text-surface-400 hover:bg-surface-700",
  },
  debug: {
    active: "bg-surface-600 text-surface-100",
    inactive: "bg-surface-800 text-surface-400 hover:bg-surface-700",
  },
  info: {
    active: "bg-accent-600 text-accent-900",
    inactive: "bg-surface-800 text-surface-400 hover:bg-surface-700",
  },
  warn: {
    active: "bg-amber-600 text-amber-100",
    inactive: "bg-surface-800 text-surface-400 hover:bg-surface-700",
  },
  error: {
    active: "bg-red-600 text-red-100",
    inactive: "bg-surface-800 text-surface-400 hover:bg-surface-700",
  },
};

interface LogsToolbarProps {
  filter: LogFilter;
  onFilterChange: (filter: LogFilter) => void;
  onClear: () => void;
  filteredCount: number;
  totalCount: number;
  filteredLogs: LogEntry[];
}

export function LogsToolbar({
  filter,
  onFilterChange,
  onClear,
  filteredCount,
  totalCount,
  filteredLogs,
}: LogsToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Profiling state
  const [profilingType, setProfilingType] = useState<"cpu" | "trace" | null>(null);
  const [profilingResult, setProfilingResult] = useState<string | null>(null);
  const [profilingError, setProfilingError] = useState<string | null>(null);
  const [showProfilingMenu, setShowProfilingMenu] = useState(false);
  const profilingMenuRef = useRef<HTMLDivElement>(null);

  const toggleLevel = (level: LogLevel) => {
    const newLevels = filter.levels.includes(level)
      ? filter.levels.filter((l) => l !== level)
      : [...filter.levels, level];
    onFilterChange({ ...filter, levels: newLevels });
  };

  const selectAll = () => {
    onFilterChange({ ...filter, levels: [] });
  };

  const isAllSelected = filter.levels.length === 0;

  // Copy functionality
  const handleCopy = useCallback(async () => {
    if (filteredLogs.length === 0) return;

    const formattedLogs = formatLogsForClipboard(filteredLogs);
    await navigator.clipboard.writeText(formattedLogs);
    setIsCopied(true);
  }, [filteredLogs]);

  // Reset copy feedback after timeout
  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  // Profiling handler
  const startProfiling = useCallback(async (type: "cpu" | "trace") => {
    setShowProfilingMenu(false);
    setProfilingType(type);
    setProfilingResult(null);
    setProfilingError(null);

    try {
      const command = type === "cpu" ? "capture_cpu_profile" : "start_trace";
      const path = await invoke<string>(command, { durationSecs: 10 });
      setProfilingResult(path);
    } catch (e) {
      setProfilingError(e instanceof Error ? e.message : String(e));
    } finally {
      setProfilingType(null);
    }
  }, []);

  // Clear profiling result/error after timeout
  useEffect(() => {
    if (!profilingResult && !profilingError) return;
    const timer = setTimeout(() => {
      setProfilingResult(null);
      setProfilingError(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [profilingResult, profilingError]);

  // Close profiling menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profilingMenuRef.current && !profilingMenuRef.current.contains(e.target as Node)) {
        setShowProfilingMenu(false);
      }
    };
    if (showProfilingMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showProfilingMenu]);

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
      setFocusedIndex(0);
    }
  }, [isOpen]);

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

      const totalItems = levels.length + 1; // +1 for "All" option

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, totalItems - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedIndex === 0) {
            selectAll();
          } else {
            toggleLevel(levels[focusedIndex - 1]);
          }
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
          setFocusedIndex(totalItems - 1);
          break;
      }
    },
    [isOpen, focusedIndex, filter.levels]
  );

  // Get display text for button
  const getButtonText = () => {
    if (isAllSelected) return "All levels";
    if (filter.levels.length === 1) return filter.levels[0];
    return `${filter.levels.length} levels`;
  };

  // Get color for button based on selected levels
  const getButtonColor = () => {
    if (isAllSelected) return "bg-surface-700 text-surface-200";
    if (filter.levels.length === 1) {
      return levelColors[filter.levels[0]].active;
    }
    return "bg-surface-700 text-surface-200";
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-800 bg-surface-900/50">
      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <Search
          className="absolute left-2 top-1/2 -translate-y-1/2 text-surface-500"
          size={14}
        />
        <input
          type="text"
          placeholder="Search logs..."
          value={filter.search}
          onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
          className="w-full pl-7 pr-3 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-md text-surface-200 placeholder:text-surface-500 focus:outline-none focus:ring-1 focus:ring-accent-500 focus:border-accent-500"
        />
      </div>

      {/* Level filter dropdown */}
      <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown}>
        <button
          ref={buttonRef}
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium uppercase",
            "transition-colors focus:outline-none focus:ring-2 focus:ring-surface-500",
            getButtonColor()
          )}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span>{getButtonText()}</span>
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")}
            size={12}
          />
        </button>

        {isOpen && (
          <div
            ref={listRef}
            role="listbox"
            aria-multiselectable="true"
            aria-activedescendant={`level-option-${focusedIndex}`}
            className={cn(
              "absolute top-full left-0 mt-1 z-50",
              "w-[140px] overflow-auto",
              "bg-surface-800 border border-surface-700 rounded-lg shadow-lg",
              "py-1"
            )}
          >
            {/* All option */}
            <div
              id="level-option-0"
              role="option"
              aria-selected={isAllSelected}
              onClick={selectAll}
              onMouseEnter={() => setFocusedIndex(0)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
                "text-xs uppercase text-surface-200",
                focusedIndex === 0 && "bg-surface-700"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded border flex items-center justify-center",
                isAllSelected ? "bg-accent-600 border-accent-600" : "border-surface-500"
              )}>
                {isAllSelected && <Check size={12} />}
              </div>
              <span>All</span>
            </div>

            {/* Individual levels */}
            {levels.map((level, index) => {
              const isSelected = filter.levels.includes(level);
              const optionIndex = index + 1;
              const colors = levelColors[level];
              return (
                <div
                  key={level}
                  id={`level-option-${optionIndex}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggleLevel(level)}
                  onMouseEnter={() => setFocusedIndex(optionIndex)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
                    "text-xs uppercase",
                    focusedIndex === optionIndex && "bg-surface-700"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded border flex items-center justify-center",
                    isSelected ? colors.active : "border-surface-500"
                  )}>
                    {isSelected && <Check size={12} />}
                  </div>
                  <span className={isSelected ? colors.active.split(" ")[1] : "text-surface-200"}>
                    {level}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Count */}
      <span className="text-xs text-surface-500">
        {filteredCount === totalCount
          ? `${totalCount} logs`
          : `${filteredCount} of ${totalCount}`}
      </span>

      {/* Profiling, Copy, and Clear buttons */}
      <div className="ml-auto flex items-center gap-1">
        {/* Profiling dropdown */}
        <div ref={profilingMenuRef} className="relative">
          <button
            onClick={() => !profilingType && setShowProfilingMenu(!showProfilingMenu)}
            disabled={!!profilingType}
            className={cn(
              "p-1.5 rounded transition-colors",
              profilingType
                ? "text-amber-400 animate-pulse"
                : profilingError
                  ? "text-red-400"
                  : profilingResult
                    ? "text-green-400"
                    : "text-surface-400 hover:text-surface-200 hover:bg-surface-800",
              profilingType && "cursor-not-allowed"
            )}
            title={
              profilingType
                ? `Capturing ${profilingType === "cpu" ? "CPU flamegraph" : "chrome trace"}...`
                : profilingError
                  ? `Profiling error: ${profilingError}`
                  : profilingResult
                    ? "Profiling complete"
                    : "Profile CPU"
            }
          >
            {profilingType ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
          </button>

          {showProfilingMenu && (
            <div className="absolute top-full right-0 mt-1 z-50 w-[180px] bg-surface-800 border border-surface-700 rounded-lg shadow-lg py-1">
              <button
                onClick={() => startProfiling("cpu")}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-surface-200 hover:bg-surface-700 cursor-pointer"
              >
                CPU Flamegraph
                <span className="ml-auto text-surface-500">10s</span>
              </button>
              <button
                onClick={() => startProfiling("trace")}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-surface-200 hover:bg-surface-700 cursor-pointer"
              >
                Chrome Trace
                <span className="ml-auto text-surface-500">10s</span>
              </button>
            </div>
          )}

          {profilingResult && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-lg px-3 py-2">
              <button
                onClick={() => open(`file://${profilingResult}`)}
                className="text-xs text-accent-400 hover:text-accent-300 whitespace-nowrap"
              >
                Open result
              </button>
            </div>
          )}
        </div>

        <button
          onClick={handleCopy}
          disabled={filteredLogs.length === 0}
          className={cn(
            "p-1.5 rounded transition-colors",
            isCopied
              ? "text-green-400"
              : "text-surface-400 hover:text-surface-200 hover:bg-surface-800",
            filteredLogs.length === 0 && "opacity-50 cursor-not-allowed"
          )}
          title={
            filteredLogs.length === 0
              ? "No logs to copy"
              : isCopied
              ? "Copied to clipboard"
              : "Copy logs to clipboard"
          }
        >
          {isCopied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          onClick={onClear}
          className="p-1.5 text-surface-400 hover:text-red-400 hover:bg-surface-800 rounded transition-colors"
          title="Clear all logs"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
