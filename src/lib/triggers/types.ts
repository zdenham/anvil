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
  // Methods for parent to render trigger results in its own UI
  getTriggerResults: () => TriggerResult[];
  getTriggerSelectedIndex: () => number;
  setTriggerSelectedIndex: (index: number) => void;
  selectTriggerResult: (result: TriggerResult) => void;
  isTriggerLoading: () => boolean;
}
