# Trigger Character System for File Input Tagging

Scalable architecture for trigger characters (e.g., `@` for files) in text inputs.

---

## Overview

**Goal:** When user types `@` in Spotlight or ActionPanel, show file autocomplete dropdown. Selected file inserts path inline (e.g., `@src/components/foo.tsx`).

**Scope:**

- Both Spotlight and ActionPanel inputs
- File search within current repository (sourcePath)
- Extensible for future triggers (`/` commands, `#` tasks)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│           TriggerSearchInput                    │
│  (wraps SearchInput, manages trigger state)     │
└─────────────────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌───────────────┐ ┌───────────┐ ┌───────────┐
│ FileTrigger   │ │ CmdTrigger│ │ TaskTrigger│
│  "@" (files)  │ │ "/" (future)│ │ "#" (future)│
└───────────────┘ └───────────┘ └───────────┘
        │
        ▼
┌───────────────────┐
│ FileSearchService │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  TriggerDropdown  │
└───────────────────┘
```

---

## Files to Create

### 1. Core Types

**`/src/lib/triggers/types.ts`** (~50 lines)

```typescript
export interface TriggerResult {
  id: string;
  label: string; // e.g., "foo.tsx"
  description: string; // e.g., "src/components/foo.tsx"
  icon?: string;
  insertText: string; // e.g., "@src/components/foo.tsx"
}

export interface TriggerConfig {
  char: string; // "@", "/", "#"
  name: string;
  placeholder: string;
  minQueryLength?: number;
  escapeChar?: string; // e.g., "\\" to type literal trigger char
}

// Track active trigger position for multi-trigger inputs
export interface ActiveTrigger {
  char: string;
  startIndex: number; // Position of trigger char in input
  endIndex: number; // Current cursor position (end of query)
  query: string;
}

export interface TriggerContext {
  rootPath: string | null; // Repository sourcePath
  taskId?: string;
  threadId?: string;
}

export interface TriggerHandler {
  readonly config: TriggerConfig;
  search(
    query: string,
    context: TriggerContext,
    signal?: AbortSignal
  ): Promise<TriggerResult[]>;
  onSelect?(result: TriggerResult): void;
}

// Selection result returned from hook - includes new value and cursor position
export interface SelectionResult {
  value: string;
  cursorPosition: number;
}

// Ref type for TriggerSearchInput (textarea-based)
export interface TriggerSearchInputRef {
  focus: () => void;
  blur: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getCursorPosition: () => number;
  setCursorPosition: (pos: number) => void;
  closeTrigger: () => void;
  isTriggerActive: () => boolean; // Exposed for parent keyboard coordination
}
```

### 2. Registry

**`/src/lib/triggers/registry.ts`** (~70 lines)

Registry for trigger handlers. Supports both singleton (app-wide) and instance (per-context) usage for testability.

```typescript
import { logger } from "@/lib/logger-client";
import type { TriggerHandler } from "./types";

export class TriggerRegistry {
  private handlers = new Map<string, TriggerHandler>();
  private static instance: TriggerRegistry | null = null;

  // Singleton accessor for app-wide use
  static getInstance(): TriggerRegistry {
    if (!TriggerRegistry.instance) {
      TriggerRegistry.instance = new TriggerRegistry();
    }
    return TriggerRegistry.instance;
  }

  // Reset for testing
  static resetInstance(): void {
    TriggerRegistry.instance = null;
  }

  register(handler: TriggerHandler): void {
    if (this.handlers.has(handler.config.char)) {
      logger.warn(
        `Overwriting existing handler for trigger char: ${handler.config.char}`
      );
    }
    this.handlers.set(handler.config.char, handler);
  }

  unregister(char: string): void {
    this.handlers.delete(char);
  }

  getHandler(char: string): TriggerHandler | undefined {
    return this.handlers.get(char);
  }

  isTrigger(char: string): boolean {
    return this.handlers.has(char);
  }

  getTriggerChars(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// Default singleton export for production use
export const triggerRegistry = TriggerRegistry.getInstance();
```

**Testing usage:**

```typescript
// In tests, create fresh instance
const registry = new TriggerRegistry();
registry.register(mockHandler);

// Or reset singleton between tests
beforeEach(() => TriggerRegistry.resetInstance());
```

### 3. File Search Service

**`/src/lib/triggers/file-search-service.ts`** (~60 lines)

Uses `git ls-files` for fast, gitignore-respecting file listing. Git's index serves as the cache.

```typescript
import { logger } from "@/lib/logger-client";
import { exec } from "@/lib/exec-client";

export interface FileSearchResult {
  path: string; // Relative path from root
  filename: string;
  extension: string;
  score: number; // Match score (0-1)
}

export interface FileSearchOptions {
  maxResults?: number; // Default: 20
}

export class FileSearchService {
  async search(
    rootPath: string,
    query: string,
    options: FileSearchOptions = {}
  ): Promise<FileSearchResult[]> {
    const { maxResults = 20 } = options;

    if (!rootPath) {
      return [];
    }

    try {
      // git ls-files: fast, respects .gitignore, uses git's index as cache
      const { stdout } = await exec("git ls-files", { cwd: rootPath });
      const files = stdout.split("\n").filter(Boolean);

      // Early return for empty query - show first N files
      if (!query.trim()) {
        return files.slice(0, maxResults).map((f) => this.toResult(f, 0));
      }

      // Score and sort by match quality
      const lowerQuery = query.toLowerCase();
      return files
        .map((f) => ({ path: f, score: this.score(f, lowerQuery) }))
        .filter((f) => f.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map((f) => this.toResult(f.path, f.score));
    } catch (error) {
      // Not a git repo or git not available
      logger.warn(`git ls-files failed in ${rootPath}:`, error);
      return [];
    }
  }

  private toResult(path: string, score: number): FileSearchResult {
    const filename = path.split("/").pop() || path;
    return {
      path,
      filename,
      extension: filename.split(".").pop() || "",
      score,
    };
  }

  /**
   * Simple scoring:
   * - Filename exact match: 1.0
   * - Filename contains query: 0.8
   * - Path contains query: 0.5
   * - Filename starts with query: +0.1 bonus
   */
  private score(path: string, lowerQuery: string): number {
    const lowerPath = path.toLowerCase();
    const filename = path.split("/").pop() || path;
    const lowerFilename = filename.toLowerCase();

    if (lowerFilename === lowerQuery) return 1.0;
    if (lowerFilename.startsWith(lowerQuery)) return 0.9;
    if (lowerFilename.includes(lowerQuery)) return 0.8;
    if (lowerPath.includes(lowerQuery)) return 0.5;
    return 0;
  }
}

// Singleton instance
let instance: FileSearchService | null = null;

export function getFileSearchService(): FileSearchService {
  if (!instance) {
    instance = new FileSearchService();
  }
  return instance;
}

export function resetFileSearchService(): void {
  instance = null;
}
```

### 4. File Trigger Handler

**`/src/lib/triggers/handlers/file-handler.ts`** (~60 lines)

```typescript
import { getFileSearchService } from "../file-search-service";
import type {
  TriggerHandler,
  TriggerConfig,
  TriggerContext,
  TriggerResult,
} from "../types";

export class FileTriggerHandler implements TriggerHandler {
  readonly config: TriggerConfig = {
    char: "@",
    name: "File",
    placeholder: "Search files...",
    minQueryLength: 2,
  };

  async search(
    query: string,
    context: TriggerContext,
    signal?: AbortSignal
  ): Promise<TriggerResult[]> {
    if (!context.rootPath) {
      return [];
    }

    const fileService = getFileSearchService();
    const results = await fileService.search(context.rootPath, query, {
      signal,
    });

    return results.map((file) => ({
      id: file.path,
      label: file.filename,
      description: file.path,
      icon: file.extension,
      insertText: `@${file.path}`,
    }));
  }
}
```

### 5. Trigger Dropdown Component

**`/src/components/reusable/trigger-dropdown.tsx`** (~220 lines)

Based on existing `FileJumpDropdown` pattern:

- Keyboard navigation (Arrow keys, Enter, Escape, Tab)
- Scroll selected into view
- Icon mapping for file types
- Loading/empty states
- Smart positioning with boundary detection

```typescript
export interface TriggerDropdownProps {
  isOpen: boolean;
  config: TriggerConfig;
  results: TriggerResult[];
  selectedIndex: number;
  isLoading?: boolean;
  error?: string | null; // Error message to display
  onSelectIndex: (index: number) => void;
  onActivate: (result: TriggerResult) => void;
  onClose: () => void;
  anchorRect: DOMRect; // Input element bounds for positioning
  containerRef?: RefObject<HTMLElement>; // Optional boundary container
}

// Render error state in dropdown
function renderContent(props: TriggerDropdownProps) {
  const { results, isLoading, error, config } = props;

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
        <Loader className="w-4 h-4 animate-spin" />
        Searching...
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="p-3 text-surface-400 text-sm">
        {EMPTY_STATES.noResults}
      </div>
    );
  }

  // Render results list...
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
  // Fallback: 'file'
};

function getFileIcon(extension: string): string {
  return FILE_ICONS[extension.toLowerCase()] || "file";
}

// Dropdown positioning with boundary detection
function calculatePosition(
  anchorRect: DOMRect,
  dropdownHeight: number,
  containerRef?: RefObject<HTMLElement>
): { top: number; left: number; direction: "up" | "down" } {
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

  return {
    top: anchorRect.top - dropdownHeight - 4,
    left: anchorRect.left,
    direction: "up",
  };
}

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

// Empty state messages
const EMPTY_STATES = {
  noQuery: "Type to search files",
  noResults: "No matching files found",
  noRootPath: "No repository selected",
  error: "Error searching files",
};
```

### 6. Autocomplete Hook

**`/src/hooks/use-trigger-autocomplete.ts`** (~250 lines)

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';
import { triggerRegistry } from '@/lib/triggers/registry';
import type { TriggerResult, TriggerHandler, TriggerContext, SelectionResult } from '@/lib/triggers/types';

export interface TriggerState {
  isActive: boolean;
  triggerChar: string | null;
  query: string;
  startIndex: number;      // Position of trigger in input
  results: TriggerResult[];
  selectedIndex: number;
  isLoading: boolean;
  handler: TriggerHandler | null;
  error: string | null;
}

export interface TriggerAutocompleteOptions {
  context: TriggerContext;
  debounceMs?: number;          // Default: 150ms
  adaptiveDebounce?: boolean;   // Increase debounce on slow responses
}

const INITIAL_STATE: TriggerState = {
  isActive: false,
  triggerChar: null,
  query: '',
  startIndex: 0,
  results: [],
  selectedIndex: 0,
  isLoading: false,
  handler: null,
  error: null,
};

export function useTriggerAutocomplete(options: TriggerAutocompleteOptions) {
  const { context, debounceMs = 150 } = options;
  const [state, setState] = useState<TriggerState>(INITIAL_STATE);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentValueRef = useRef<string>('');  // Track current input value

  // Cancel any pending search when starting a new one
  const cancelPendingSearch = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPendingSearch();
    };
  }, [cancelPendingSearch]);

  const close = useCallback(() => {
    cancelPendingSearch();
    setState(INITIAL_STATE);
  }, [cancelPendingSearch]);

  const setSelectedIndex = useCallback((index: number) => {
    setState((prev) => ({ ...prev, selectedIndex: index }));
  }, []);

  // Returns SelectionResult with new value and cursor position
  const selectResult = useCallback((result: TriggerResult): SelectionResult | null => {
    if (!state.isActive) return null;

    const currentValue = currentValueRef.current;
    const before = currentValue.slice(0, state.startIndex);
    const after = currentValue.slice(state.startIndex + 1 + state.query.length);

    // Insert with trailing space for continuation
    const newValue = before + result.insertText + ' ' + after;
    const newCursorPosition = before.length + result.insertText.length + 1;

    close();

    return {
      value: newValue,
      cursorPosition: newCursorPosition,
    };
  }, [state.isActive, state.startIndex, state.query.length, close]);

  return {
    state,
    analyzeInput: (value: string, cursorPosition: number, inputType?: string) => void,
    selectResult,
    close,
    setSelectedIndex,
    cancelPendingSearch,
    // Store current value for selectResult to use
    setCurrentValue: (value: string) => { currentValueRef.current = value; },
  };
}
```

**Key logic in `analyzeInput`:**

```typescript
const analyzeInput = useCallback(
  (value: string, cursorPosition: number, inputType?: string): void => {
    // Store current value for selectResult
    currentValueRef.current = value;

    // 1. Handle paste - don't activate on paste
    if (inputType === "insertFromPaste") {
      close();
      return;
    }

    // 2. Scan backwards from cursor for trigger char
    let triggerIndex = -1;
    let triggerChar: string | null = null;
    let isEscaped = false;

    for (let i = cursorPosition - 1; i >= 0; i--) {
      const char = value[i];

      // Stop at whitespace or newline - no trigger found in current word
      // (textarea can have newlines, treat them as word boundaries)
      if (/\s/.test(char)) break;

      // Check for escape sequence (double trigger char = literal)
      if (triggerRegistry.isTrigger(char)) {
        // Check if escaped: @@foo -> literal @foo, not trigger
        if (i > 0 && value[i - 1] === char) {
          isEscaped = true;
          break; // Escaped, don't trigger
        }

        // Check word boundary: only trigger at start or after whitespace
        if (i === 0 || /\s/.test(value[i - 1])) {
          triggerIndex = i;
          triggerChar = char;
          break;
        }
      }
    }

    // 3. No trigger found - close any active trigger
    if (triggerIndex === -1 || isEscaped) {
      close();
      return;
    }

    // 4. Extract query and get handler
    const query = value.slice(triggerIndex + 1, cursorPosition);
    const handler = triggerRegistry.getHandler(triggerChar!);

    if (!handler) {
      close();
      return;
    }

    // 5. Update state immediately (show loading)
    setState((prev) => ({
      ...prev,
      isActive: true,
      triggerChar,
      query,
      startIndex: triggerIndex,
      handler,
      isLoading: true,
      error: null,
    }));

    // 6. Debounce the search
    cancelPendingSearch();

    debounceTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      handler
        .search(query, context, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) {
            setState((prev) => ({
              ...prev,
              results,
              isLoading: false,
              selectedIndex: 0,
            }));
          }
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            setState((prev) => ({
              ...prev,
              error: error.message,
              isLoading: false,
            }));
          }
        });
    }, debounceMs);
  },
  [context, debounceMs, close, cancelPendingSearch]
);
```

**Text insertion strategy:**

The `selectResult` function returns a `SelectionResult` object:

```typescript
// Returns { value: string, cursorPosition: number } or null if no active trigger
const result = selectResult(selectedTriggerResult);
if (result) {
  onChange(result.value);
  // Set cursor position after React re-renders
  requestAnimationFrame(() => {
    textareaRef.current?.setSelectionRange(
      result.cursorPosition,
      result.cursorPosition
    );
  });
}
```

**Escape sequence handling (`@@` -> `@`):**

When user types `@@`, the second `@` is detected as escaped (see analyzeInput step 2).
The escape sequence is NOT automatically transformed - both `@` chars remain in the input.
This is intentional: the user explicitly typed `@@` to indicate a literal `@`, and we preserve their input.

If auto-transformation is desired, add a separate handler:

```typescript
// Optional: Transform @@ to @ on blur or submit
function normalizeEscapeSequences(value: string): string {
  return value.replace(/@@/g, "@");
}
```

**Multi-trigger handling:**

- Only the trigger closest to cursor (scanning backwards) is active
- Previous completed triggers (e.g., `@src/foo.ts `) are treated as regular text
- Cursor navigation out of trigger range deactivates autocomplete
- Newlines in textarea are treated as word boundaries (trigger resets per line)

### 7. Wrapper Component

**`/src/components/reusable/trigger-search-input.tsx`** (~220 lines)

```typescript
import React, {
  forwardRef,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
} from "react";
import { SearchInput, type SearchInputProps } from "./search-input";
import { TriggerDropdown } from "./trigger-dropdown";
import { useTriggerAutocomplete } from "@/hooks/use-trigger-autocomplete";
import type {
  TriggerContext,
  TriggerSearchInputRef,
  TriggerResult,
} from "@/lib/triggers/types";

// Note: SearchInput is a TEXTAREA, not an input - cursor tracking uses selectionStart/End
export interface TriggerSearchInputProps
  extends Omit<SearchInputProps, "onChange"> {
  triggerContext: TriggerContext;
  onChange?: (value: string) => void;
  enableTriggers?: boolean;
}

export const TriggerSearchInput = forwardRef<
  TriggerSearchInputRef,
  TriggerSearchInputProps
>(
  (
    { triggerContext, onChange, enableTriggers = true, onKeyDown, ...props },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const cursorPositionRef = useRef<number>(0);

    const {
      state: triggerState,
      analyzeInput,
      selectResult,
      close: closeTrigger,
      setSelectedIndex,
    } = useTriggerAutocomplete({ context: triggerContext });

    // Update anchor rect when trigger becomes active or input scrolls
    const updateAnchorRect = useCallback(() => {
      if (textareaRef.current) {
        setAnchorRect(textareaRef.current.getBoundingClientRect());
      }
    }, []);

    // Expose ref methods including isTriggerActive for parent coordination
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      blur: () => textareaRef.current?.blur(),
      getValue: () => textareaRef.current?.value ?? "",
      setValue: (value: string) => {
        if (textareaRef.current) textareaRef.current.value = value;
      },
      getCursorPosition: () => textareaRef.current?.selectionStart ?? 0,
      setCursorPosition: (pos: number) => {
        textareaRef.current?.setSelectionRange(pos, pos);
      },
      closeTrigger,
      isTriggerActive: () => triggerState.isActive,
    }));

    // ... rest of component
  }
);
```

Wraps `SearchInput` (a textarea) and renders `TriggerDropdown` when active.

**Keyboard event handling:**

```typescript
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // When trigger is active, intercept navigation keys
  if (triggerState.isActive) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation(); // Prevent parent (e.g., Spotlight) from handling
        setSelectedIndex(
          Math.min(
            triggerState.selectedIndex + 1,
            triggerState.results.length - 1
          )
        );
        return; // Don't call parent handler

      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(Math.max(triggerState.selectedIndex - 1, 0));
        return;

      case "Enter":
        // Only intercept if not holding Shift (Shift+Enter = newline in textarea)
        if (!e.shiftKey && triggerState.results[triggerState.selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          handleSelectResult(triggerState.results[triggerState.selectedIndex]);
          return;
        }
        break;

      case "Tab":
        // Tab completes selection (like shell autocomplete)
        if (triggerState.results[triggerState.selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          handleSelectResult(triggerState.results[triggerState.selectedIndex]);
          return;
        }
        break;

      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeTrigger();
        return;
    }
  }

  // Call parent handler for non-intercepted keys
  onKeyDown?.(e);
};

const handleSelectResult = (result: TriggerResult) => {
  const selectionResult = selectResult(result);
  if (selectionResult) {
    onChange?.(selectionResult.value);
    // Set cursor position after React re-renders the textarea
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(
        selectionResult.cursorPosition,
        selectionResult.cursorPosition
      );
    });
  }
};
```

**IME (Input Method Editor) handling:**

```typescript
const handleCompositionStart = () => {
  setIsComposing(true);
  // Don't analyze input during IME composition
};

const handleCompositionEnd = (
  e: React.CompositionEvent<HTMLTextAreaElement>
) => {
  setIsComposing(false);
  // Analyze the final composed text
  const target = e.target as HTMLTextAreaElement;
  analyzeInput(target.value, target.selectionStart ?? 0);
};

// Handle change from SearchInput (receives event, not just value)
const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const value = e.target.value;
  const cursorPos = e.target.selectionStart ?? 0;
  cursorPositionRef.current = cursorPos;

  onChange?.(value);

  // Skip analysis during IME composition
  if (!isComposing && enableTriggers) {
    const inputType = (e.nativeEvent as InputEvent).inputType;
    analyzeInput(value, cursorPos, inputType);
    updateAnchorRect();
  }
};

// Track cursor position changes (click, arrow keys within input)
const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
  const target = e.target as HTMLTextAreaElement;
  const cursorPos = target.selectionStart ?? 0;

  if (cursorPos !== cursorPositionRef.current) {
    cursorPositionRef.current = cursorPos;
    // Re-analyze when cursor moves (might exit trigger range)
    if (enableTriggers && !isComposing) {
      analyzeInput(target.value, cursorPos);
    }
  }
};
```

**Rendering with dropdown:**

```typescript
return (
  <div className="relative">
    <SearchInput
      ref={textareaRef}
      {...props}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onSelect={handleSelect}
    />
    {triggerState.isActive && anchorRect && (
      <TriggerDropdown
        isOpen={true}
        config={triggerState.handler!.config}
        results={triggerState.results}
        selectedIndex={triggerState.selectedIndex}
        isLoading={triggerState.isLoading}
        error={triggerState.error}
        onSelectIndex={setSelectedIndex}
        onActivate={handleSelectResult}
        onClose={closeTrigger}
        anchorRect={anchorRect}
      />
    )}
  </div>
);
```

**Note on visual trigger indicator:**

The visual indicator (highlighting the trigger query) is omitted from MVP due to complexity of positioning in a multi-line textarea. The textarea's `selectionStart` gives character position, but converting to pixel coordinates requires measuring text - deferred to future enhancement.

### 8. Initialization

**`/src/lib/triggers/index.ts`** (~30 lines)

```typescript
import { triggerRegistry } from "./registry";
import { FileTriggerHandler } from "./handlers/file-handler";

let initialized = false;

export function initializeTriggers(): void {
  if (initialized) return; // Idempotent for HMR safety
  initialized = true;

  triggerRegistry.register(new FileTriggerHandler());
  // Future: register CommandTriggerHandler, TaskTriggerHandler
}

// Re-export for convenience
export { triggerRegistry } from "./registry";
export type * from "./types";
```

**Call location:** In `/src/App.tsx` (or `/src/main.tsx`), call `initializeTriggers()` synchronously at module load or in App component mount:

```typescript
// /src/App.tsx
import { useEffect } from 'react';
import { initializeTriggers } from '@/lib/triggers';

export function App() {
  // Initialize triggers once on app mount
  useEffect(() => {
    initializeTriggers();
  }, []);

  return (
    // ... app content
  );
}
```

For Tauri apps with multiple windows (Spotlight, Main), each window loads its own JS bundle, so `initializeTriggers()` runs per-window - this is correct since each window needs its own registry instance.

---

## Files to Modify

### 1. Spotlight

**`/src/components/spotlight/spotlight.tsx`**

Replace `SearchInput` with `TriggerSearchInput` and coordinate keyboard handling:

```typescript
// Add ref type
const inputRef = useRef<TriggerSearchInputRef>(null);

// Modify the document keydown handler to check if trigger is active
useEffect(
  () => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // If trigger dropdown is active, let it handle navigation keys
      if (inputRef.current?.isTriggerActive()) {
        // Arrow keys, Enter, Tab, Escape are handled by TriggerSearchInput
        if (
          ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)
        ) {
          return; // Don't handle here - TriggerSearchInput will handle
        }
      }

      // Original Spotlight key handling...
      switch (e.key) {
        case "Escape":
          await controller.hideSpotlight();
          break;
        case "ArrowDown":
          // ... existing logic for result navigation
          break;
        // ... etc
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  },
  [
    /* deps */
  ]
);

// Replace SearchInput with TriggerSearchInput
<TriggerSearchInput
  ref={inputRef}
  value={query}
  onChange={handleQueryChange}
  onExpandedChange={handleExpandedChange}
  hasContentBelow={results.length > 0}
  triggerContext={{
    rootPath: controller.getDefaultRepository()?.sourcePath ?? null,
  }}
  autoFocus
/>;
```

**Key insight:** Spotlight uses document-level `addEventListener('keydown', ...)`. The `stopPropagation()` in TriggerSearchInput won't prevent this. Solution: Spotlight checks `inputRef.current?.isTriggerActive()` before handling keys.

### 2. ActionPanel

**`/src/components/workspace/action-panel.tsx`**

Replace `SearchInput` with `TriggerSearchInput`. Note: ActionPanel currently uses event-based onChange (`onChange={(e) => setInputValue(e.target.value)}`), but TriggerSearchInput provides value-based onChange.

```typescript
// Add repo context (get from task's repository)
const repo = useRepoStore((state) =>
  task?.repositoryName ? state.repos[task.repositoryName] : null
);

// Replace SearchInput instances with TriggerSearchInput:
<TriggerSearchInput
  ref={inputRef}
  value={inputValue}
  onChange={setInputValue} // Value-based, not event-based
  onKeyDown={handleReviewKeyDown}
  placeholder={latestReview.defaultResponse}
  hasContentBelow={false}
  triggerContext={{
    rootPath: repo?.sourcePath ?? null,
    taskId: taskId ?? undefined,
    threadId: undefined, // ActionPanel doesn't always have threadId
  }}
  autoFocus
  className="flex-1"
/>;
```

ActionPanel's existing `onKeyDown` handlers (Enter to submit) will still work because TriggerSearchInput only intercepts when trigger is active.

### 3. App Bootstrap

**`/src/App.tsx`**

Call `initializeTriggers()` on app startup (see Initialization section above for full example).

---

## Implementation Sequence

1. **Core types & registry** - `types.ts`, `registry.ts`
2. **File search service** - `file-search-service.ts`
3. **File trigger handler** - `handlers/file-handler.ts`
4. **Trigger dropdown UI** - `trigger-dropdown.tsx`
5. **Autocomplete hook** - `use-trigger-autocomplete.ts`
6. **Wrapper component** - `trigger-search-input.tsx`
7. **Initialization** - `index.ts`
8. **Integration** - Update Spotlight, ActionPanel
9. **Tests**

---

## Testing

### Unit Tests (vitest)

- `file-search-service.test.ts` - Fuzzy matching, caching, exclusions
- `registry.test.ts` - Registration, lookup

Run with: `pnpm test`

**File search test cases:**

```typescript
describe("FileSearchService", () => {
  it("returns empty array for non-git directory", async () => {
    const results = await service.search("/tmp/not-a-repo", "foo");
    expect(results).toEqual([]);
  });

  it("scores filename exact match highest", async () => {
    const results = await service.search(repoPath, "foo.ts");
    expect(results[0].filename).toBe("foo.ts");
    expect(results[0].score).toBe(1.0);
  });

  it("scores filename prefix higher than substring", async () => {
    // Given files: ['foobar.ts', 'bazfoo.ts']
    const results = await service.search(repoPath, "foo");
    expect(results[0].filename).toBe("foobar.ts"); // starts with 'foo'
  });

  it("respects gitignore", async () => {
    // Given .gitignore contains 'dist/'
    const results = await service.search(repoPath, "bundle");
    expect(results.find((r) => r.path.startsWith("dist/"))).toBeUndefined();
  });
});
```

### UI Tests (happy-dom)

- `trigger-dropdown.ui.test.tsx` - Rendering, selection, keyboard nav
- `trigger-search-input.ui.test.tsx` - Integration with dropdown

Run with: `pnpm test:ui`

**Accessibility test cases:**

```typescript
describe("TriggerDropdown accessibility", () => {
  it("has correct ARIA attributes", () => {
    render(<TriggerDropdown {...props} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { selected: true })).toBeInTheDocument();
  });

  it("announces results to screen readers", () => {
    render(<TriggerDropdown {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("5 results");
  });

  it("manages focus correctly", () => {
    // Focus should remain in input, not move to dropdown
    render(<TriggerSearchInput {...props} />);
    const input = screen.getByRole("textbox");
    expect(document.activeElement).toBe(input);
  });
});
```

### Integration Tests (vitest)

- `use-trigger-autocomplete.test.ts` - Trigger activation logic

Run with: `pnpm test`

**Race condition test cases:**

```typescript
describe("useTriggerAutocomplete race conditions", () => {
  it("cancels stale searches on rapid typing", async () => {
    const { result } = renderHook(() => useTriggerAutocomplete(options));

    // Type rapidly
    act(() => result.current.analyzeInput("@f", 2));
    act(() => result.current.analyzeInput("@fo", 3));
    act(() => result.current.analyzeInput("@foo", 4));

    await waitFor(() => {
      // Only final search results should be displayed
      expect(result.current.state.query).toBe("foo");
    });
  });

  it("handles slow filesystem responses", async () => {
    // Mock slow search
    mockSearch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 500))
    );

    const { result } = renderHook(() => useTriggerAutocomplete(options));

    act(() => result.current.analyzeInput("@test", 5));
    act(() => result.current.close()); // User closes before response

    await waitFor(() => {
      expect(result.current.state.isActive).toBe(false);
      expect(result.current.state.results).toEqual([]);
    });
  });

  it("ignores results from cancelled searches", async () => {
    let resolveFirst: (v: TriggerResult[]) => void;
    const firstSearch = new Promise<TriggerResult[]>((r) => (resolveFirst = r));

    mockSearch
      .mockImplementationOnce(() => firstSearch)
      .mockImplementationOnce(() =>
        Promise.resolve([{ id: "2", label: "second" }])
      );

    const { result } = renderHook(() => useTriggerAutocomplete(options));

    act(() => result.current.analyzeInput("@first", 6));
    act(() => result.current.analyzeInput("@second", 7));

    // Resolve first search after second
    resolveFirst!([{ id: "1", label: "first" }]);

    await waitFor(() => {
      // Should show second search results, not first
      expect(result.current.state.results[0]?.label).toBe("second");
    });
  });
});
```

**Special filename test cases:**

```typescript
describe("special filename handling", () => {
  it("handles filenames with @ symbol", () => {
    // foo@bar.tsx should be found when searching "foo"
    const results = service.search(root, "foo");
    expect(results.some((r) => r.filename === "foo@bar.tsx")).toBe(true);
  });

  it("handles filenames with spaces", () => {
    const results = service.search(root, "my file");
    expect(results.some((r) => r.filename === "my file.ts")).toBe(true);
  });

  it("handles unicode filenames", () => {
    const results = service.search(root, "日本");
    expect(results.some((r) => r.filename === "日本語.ts")).toBe(true);
  });

  it("handles very long filenames", () => {
    const longName = "a".repeat(200) + ".ts";
    const results = service.search(root, "aaa");
    expect(results.some((r) => r.filename === longName)).toBe(true);
  });
});
```

### Manual Testing

1. Type `@` in Spotlight - dropdown appears
2. Type `@app` - filters to matching files
3. Arrow keys navigate, Enter selects
4. Selected file inserts as `@path/to/file.tsx`
5. Escape closes dropdown
6. Same behavior in ActionPanel
7. Type `@@` - no dropdown, literal `@` remains
8. Type `email@test.com` - no dropdown triggers
9. Paste text containing `@` - no dropdown triggers
10. Test with Japanese IME - composition works correctly

---

## Future Extensions

To add a new trigger (e.g., `/` for commands):

1. Create `handlers/command-handler.ts` implementing `TriggerHandler`
2. Register in `index.ts`: `triggerRegistry.register(new CommandTriggerHandler())`

No changes needed to UI components or hooks.

---

## Key Design Decisions

1. **Registry pattern** - Extensible without modifying existing code
2. **Word boundary detection** - `@` in `email@test.com` won't trigger
3. **Debounced search** - 150ms default to avoid excessive calls
4. **`git ls-files`** - Fast, respects .gitignore, no custom caching needed
5. **Inline path insertion** - `@path/to/file` format (not content embedding)
6. **Shared dropdown** - One component for all triggers with config-driven UI
7. **Escape mechanism** - Double trigger char (`@@`) inserts literal char
8. **Paste handling** - Pasted content never activates autocomplete
9. **IME support** - Composition events handled separately from regular input
10. **Graceful degradation** - Null rootPath or non-git directory returns empty results, not error

---

## Edge Case Handling

### Trigger in Quoted Strings / Code Blocks

The trigger system uses **word boundary detection only**, not full syntax parsing. This means:

- `"email@domain.com"` - No trigger (@ not at word boundary)
- `` `@Injectable()` `` - WILL trigger (@ is at word boundary after backtick)

**Mitigation:** This is acceptable for MVP. The dropdown appears but user can simply continue typing or press Escape. Future enhancement could add basic quote/backtick context detection.

### Multiple Triggers in Same Input

Only one trigger is active at a time - the one closest to the cursor, scanning backwards:

- `@src/foo.ts and @` - Second `@` is active
- `@src/foo.ts @bar` with cursor after "bar" - `@bar` is active
- `@src/foo.ts ` with cursor at end - No trigger active (whitespace terminates)

### Escape Mechanism

Double trigger char inserts a literal:

- `@@` becomes `@` (no dropdown)
- `//` becomes `/` (when command trigger added)

The second character is consumed during analysis, leaving single char in input.

### Pasted Content

`inputType === 'insertFromPaste'` is detected via `InputEvent.inputType` and bypasses trigger analysis entirely. This prevents unexpected dropdowns when pasting URLs or code.

### Cursor Navigation Mid-Trigger

When user moves cursor (left/right arrow, mouse click) out of the trigger range:

- If cursor moves before trigger char: close dropdown
- If cursor moves into whitespace: close dropdown
- Re-analyze on every cursor position change via `onSelect` event

---

## Error Handling Strategy

### Filesystem Errors

```typescript
import { logger } from "@/lib/logger-client";

// In walkDirectory - catch and log, don't throw
try {
  const entries = await this.fsClient.listDir(path);
  // ...
} catch (error) {
  // Permission denied, network drive disconnected, symlink loop, etc.
  logger.warn(`Failed to read directory ${path}:`, error);
  // Continue with partial results - don't fail entire search
}
```

**Note:** Per codebase guidelines (`docs/agents.md`), use `logger` from `@/lib/logger-client` instead of `console.log/warn/error`.

### Null rootPath

```typescript
async search(rootPath: string | null, query: string): Promise<FileSearchResult[]> {
  if (!rootPath) {
    // No repo selected - return empty results, not error
    return [];
  }
  // ...
}
```

The dropdown will show "No repository selected" empty state.

### Search Cancellation

All search operations accept `AbortSignal` and check `signal.aborted`:

- Between directory reads in `walkDirectory`
- Before setting results in the hook
- `AbortError` is caught and ignored (not shown as error state)

---

## Performance Constraints

| Constraint           | Value | Rationale                      |
| -------------------- | ----- | ------------------------------ |
| Debounce delay       | 150ms | Responsive feel, reduces calls |
| Max results returned | 20    | UI performance, scroll depth   |

### Why `git ls-files`?

- **Fast:** Uses git's pre-built index, no directory traversal
- **Correct:** Respects `.gitignore` automatically
- **No caching needed:** Git's index is the cache
- **Handles edge cases:** Symlinks, submodules, large repos

**Trade-off:** Requires git repo. Non-git directories return empty results. This is acceptable since the feature is scoped to "current repository".

---

## Accessibility Requirements

### ARIA Attributes

```html
<input
  role="combobox"
  aria-expanded={isDropdownOpen}
  aria-haspopup="listbox"
  aria-controls="trigger-dropdown"
  aria-activedescendant={`option-${selectedIndex}`}
/>

<ul role="listbox" id="trigger-dropdown">
  <li role="option" id="option-0" aria-selected={selectedIndex === 0}>
    ...
  </li>
</ul>

<!-- Live region for result count -->
<div role="status" aria-live="polite" className="sr-only">
  {results.length} files found
</div>
```

### Focus Management

- Focus remains in input at all times
- Arrow keys navigate dropdown via `aria-activedescendant`
- Enter/Tab activates without moving focus
- Escape closes dropdown and keeps focus in input

---

## Review Round 1 - Identified Gaps (Resolution Status)

### Edge Cases (1-5)

1. **Trigger in quoted strings/code blocks** - ADDRESSED: See "Edge Case Handling" section. Word boundary detection handles most cases; backtick edge case documented as acceptable for MVP.
2. **Multiple triggers in same input** - ADDRESSED: See "Edge Case Handling > Multiple Triggers". Only closest trigger to cursor is active.
3. **No escape mechanism** - ADDRESSED: Double trigger char (`@@`) escapes. See "Edge Case Handling > Escape Mechanism".
4. **Pasted content with triggers** - ADDRESSED: `inputType === 'insertFromPaste'` bypasses trigger. See `analyzeInput` in hook.
5. **Cursor navigation mid-trigger** - ADDRESSED: See "Edge Case Handling > Cursor Navigation Mid-Trigger".

### Architecture (6-9)

6. **Blocking recursive directory walk** - REMOVED: Now using `git ls-files` which is fast and non-blocking.
7. **Singleton registry couples globally** - ADDRESSED: Registry now supports both singleton and instance patterns. See `TriggerRegistry.resetInstance()` for testing.
8. **Cache invalidation unclear** - REMOVED: `git ls-files` uses git's index as cache, always up-to-date with tracked files.
9. **Dropdown positioning fragile** - ADDRESSED: `calculatePosition` function handles boundary detection. See `TriggerDropdown` section.

### Implementation Gaps (10-14)

10. **Fuzzy matching algorithm unspecified** - SIMPLIFIED: Now using substring matching with priority scoring (exact > prefix > contains). See `FileSearchService.score`.
11. **File type icon mapping undefined** - ADDRESSED: `FILE_ICONS` map defined in `TriggerDropdown` section.
12. **Tab key behavior undefined** - ADDRESSED: Tab completes selection (like shell). See keyboard handler in `TriggerSearchInput`.
13. **`TriggerSearchInputRef` type missing** - ADDRESSED: Full interface defined in types.ts section.
14. **Insert replacement strategy unclear** - ADDRESSED: `selectResult` function documented with before/after string manipulation.

### Error Handling (15-17)

15. **No filesystem error handling** - ADDRESSED: try/catch in `walkDirectory` logs and continues. See "Error Handling Strategy".
16. **Null rootPath not handled** - ADDRESSED: Returns empty array, shows "No repository selected" empty state.
17. **Search promise cancellation missing** - ADDRESSED: `AbortController` pattern throughout. See hook and service.

### Performance (18-20)

18. **No directory traversal depth limit** - REMOVED: `git ls-files` handles this internally.
19. **Unbounded cache memory** - REMOVED: `git ls-files` uses git's index, no custom caching.
20. **Fixed 150ms debounce** - Kept as-is. 150ms is reasonable for most use cases.

### UX (21-24)

21. **No visual trigger activation indicator** - DEFERRED: Visual indicator omitted from MVP due to multi-line textarea complexity. See wrapper component note in "Wrapper Component" section (line 1033-1035).
22. **Empty state content undefined** - ADDRESSED: `EMPTY_STATES` object with `noQuery`, `noResults`, `noRootPath`, `error` messages.
23. **Inserted format may confuse** - NOTED: Accepted design decision. Format is intentional for parseability.
24. **Long path handling** - ADDRESSED: `truncatePath` function preserves filename, truncates directories.

### Integration (25-27)

25. **Keyboard shortcut conflicts** - ADDRESSED: `e.stopPropagation()` prevents parent handling when trigger active.
26. **Event handling race conditions** - ADDRESSED: Cancellation via `AbortController` prevents stale updates.
27. **IME input not considered** - ADDRESSED: `compositionstart/end` handlers skip analysis during composition.

### Testing (28-31)

28. **No race condition tests** - ADDRESSED: Full test suite in "Integration Tests > Race condition test cases".
29. **No accessibility tests** - ADDRESSED: ARIA tests in "UI Tests > Accessibility test cases".
30. **No special filename tests** - ADDRESSED: Unicode, spaces, `@` in filename tests in "Special filename test cases".
31. **No E2E tests specified** - REMOVED: Playwright not used in this codebase. Manual testing checklist covers integration scenarios.

---

## Review Round 2 - Identified Gaps (Resolution Status)

### Critical Implementation Issues

1. **SearchInput is a textarea, not input** - ADDRESSED: Updated all type annotations to use `HTMLTextAreaElement`. Wrapper component explicitly notes this. Visual indicator deferred to future enhancement due to multi-line complexity. `selectionStart` works fine for textarea.

2. **Missing `getCachedFiles` implementation** - REMOVED: Now using `git ls-files` which handles caching via git's index.

3. **Spotlight keyboard conflict unresolved** - ADDRESSED: Added `isTriggerActive()` method to `TriggerSearchInputRef`. Spotlight's document-level handler checks this before handling keys. See "Files to Modify > Spotlight" section.

4. **`selectResult` return type inconsistent** - ADDRESSED: Added `SelectionResult` type to types.ts. Hook's `selectResult` returns `SelectionResult | null`. Updated all references.

5. **No debounce implementation shown** - ADDRESSED: Added `debounceTimerRef` and full debounce logic in `analyzeInput` using `setTimeout`/`clearTimeout`.

6. **Escape sequence doesn't consume character** - ADDRESSED: Clarified in "Escape sequence handling" section that `@@` is intentionally preserved (user typed it). Optional `normalizeEscapeSequences()` function provided for transformation on submit.

### Missing Connections

7. **Registry access path unclear** - ADDRESSED: Hook imports `triggerRegistry` singleton directly. Added explicit import statement in hook code.

8. **`anchorRect` for dropdown never obtained** - ADDRESSED: Added `updateAnchorRect()` callback and `anchorRect` state in wrapper component. Called on trigger activation.

9. **FileSearchService instantiation location** - ADDRESSED: Added `getFileSearchService()` singleton accessor and `resetFileSearchService()` for testing. Handler uses singleton via import.

10. **`initializeTriggers()` call location vague** - ADDRESSED: Specified `/src/App.tsx` with full code example. Added idempotency guard for HMR. Explained per-window behavior for Tauri.

### Integration Issues

11. **ActionPanel onChange signature mismatch** - ADDRESSED: TriggerSearchInput accepts value-based `onChange?: (value: string) => void`. ActionPanel passes `setInputValue` directly. Cursor position obtained from event in internal `handleChange`.

12. **Cursor position handlers not wired** - ADDRESSED: Added `onSelect` handler in wrapper component to re-analyze on cursor position change (click, arrow keys).

13. **`console.warn` violates codebase guidelines** - ADDRESSED: Replaced all `console.warn` with `logger.warn` from `@/lib/logger-client`. Added import statements.

### Cleanup/Hooks

14. **Missing unmount cleanup** - ADDRESSED: Added `useEffect` cleanup in hook that calls `cancelPendingSearch()` on unmount.

15. **Error state UI rendering undefined** - ADDRESSED: Added `error` prop to `TriggerDropdownProps` and `renderContent()` function showing error state rendering.

### Minor Issues

16. **`.ui.test.tsx` naming convention** - CONFIRMED: Codebase uses `.ui.test.tsx` for UI component tests (e.g., `task-card.ui.test.tsx`, `thread-view.ui.test.tsx`). This convention is correct.

17. **FilesystemClient returns absolute paths** - ADDRESSED: The `walkDirectory` implementation constructs relative paths by removing root prefix: `path.replace(root, '').replace(/^\//, '')`.

18. **cursorPosition variable undefined** - ADDRESSED: `selectResult` now uses `currentValueRef.current` and `state.startIndex + 1 + state.query.length` instead of undefined `cursorPosition`.

---

## Review Round 3 - Final Review

### Minor Issues Found

1. **App.tsx filename casing** - Plan references `/src/app.tsx` but actual file is `/src/App.tsx` (capital A). Fix the reference.

2. **Both Spotlight and ActionPanel use event-based onChange** - Plan notes ActionPanel uses event-based pattern, but Spotlight does too. TriggerSearchInput's internal `handleChange` extracts value from event and calls user's value-based `onChange` prop. This is already handled correctly.

3. **Visual indicator reference contradiction** - Round 1 resolution (line 1599) says `.trigger-indicator` is addressed, but Round 2 (line 1621) correctly notes it's deferred. Remove the contradiction.

4. **Relative path construction fragility** - `path.replace(root, '')` works but `path.slice(root.length)` would be clearer. Minor code quality issue.

### Verdict

**Plan is ready for implementation.** The 4 minor issues are cosmetic or already handled correctly in the code. None would block a skilled implementer.
