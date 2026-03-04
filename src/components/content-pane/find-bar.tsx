/**
 * FindBar
 *
 * Floating search bar for find-in-page. Positioned top-right of content pane.
 * Keyboard-first: Enter/Shift+Enter cycle matches, Escape closes.
 */

import { useRef, useEffect } from "react";
import type { UseContentSearchReturn } from "./use-content-search";

interface FindBarProps {
  search: UseContentSearchReturn;
  onClose: () => void;
}

export function FindBar({ search, onClose }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "Enter" || (e.key === "g" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (e.shiftKey) {
        search.goToPrevious();
      } else {
        search.goToNext();
      }
    }
  };

  const matchDisplay =
    search.matchCount > 0
      ? `${search.currentMatch} of ${search.matchCount}`
      : search.query
        ? "No results"
        : "";

  return (
    <div data-testid="find-bar" className="absolute top-2 right-4 z-50 flex items-center gap-1.5 bg-surface-800 border border-surface-600 rounded-lg shadow-lg px-2.5 py-1.5">
      <input
        ref={inputRef}
        type="text"
        data-testid="find-bar-input"
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="bg-transparent text-surface-50 text-sm outline-none w-40 placeholder:text-surface-500"
      />

      <span className="text-xs text-surface-400 whitespace-nowrap select-none min-w-[4.5rem] text-right">
        {matchDisplay}
      </span>

      <button
        data-testid="find-bar-prev"
        onClick={search.goToPrevious}
        disabled={search.matchCount === 0}
        className="p-0.5 text-surface-400 hover:text-surface-200 disabled:opacity-30 disabled:cursor-default"
        aria-label="Previous match"
      >
        <ChevronUp />
      </button>

      <button
        data-testid="find-bar-next"
        onClick={search.goToNext}
        disabled={search.matchCount === 0}
        className="p-0.5 text-surface-400 hover:text-surface-200 disabled:opacity-30 disabled:cursor-default"
        aria-label="Next match"
      >
        <ChevronDown />
      </button>

      <button
        onClick={onClose}
        className="p-0.5 text-surface-400 hover:text-surface-200"
        aria-label="Close find bar"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function ChevronUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
