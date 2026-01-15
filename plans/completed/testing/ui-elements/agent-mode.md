# Agent Mode Implementation Plan

## Consolidated From

This plan consolidates the following plans:
- `plans/ui-elements/mode-switching.md` - Shift+Tab mode cycling UI
- `plans/ui-elements/auto-accept-mode.md` - Permission mode indicator and agent integration

Both plans managed agent behavior modes and visual indicators. They have been unified into a single agent-mode entity with one ModeIndicator component, shared store, and keyboard shortcuts.

---

## Overview

Implement a unified agent mode system that controls how the agent handles file edits and permissions. Users can cycle modes with Shift+Tab in the thread input. A visual indicator in the thread header displays the current mode.

## Agent Modes

| Mode | Behavior | Visual Cue | CLI Equivalent |
|------|----------|------------|----------------|
| `normal` | Requires approval for file edits | Gray (default) | Default behavior |
| `plan` | Agent plans but does not execute | Blue/secondary | Plan mode |
| `auto-accept` | Auto-approves file edits | Green/success | --dangerously-skip-permissions |

---

## File Structure

```
core/types/
  agent-mode.ts         # AgentMode type (shared by agents/ and src/)

src/entities/agent-mode/
  types.ts              # Mode config constants, getNextMode helper
  store.ts              # Zustand store for mode state (per-thread)
  index.ts              # Re-exports

src/components/simple-task/
  mode-indicator.tsx    # Visual mode badge with optional shortcut hint
  use-mode-keyboard.ts  # Keyboard shortcut hook (Shift+Tab)
```

---

## Pattern Compliance Notes

This feature is **UI-only ephemeral state** - mode preferences are not persisted to disk and exist only in memory for the current session. This intentionally avoids the disk-as-truth pattern since there is no cross-process synchronization needed.

Key architectural decisions:
- **No listeners.ts needed**: Mode state is purely in-memory UI state, not driven by agent events
- **No service layer**: Direct store access is appropriate for ephemeral UI preferences
- **Keyed by threadId**: Uses stable IDs per the "stable references" guideline
- **Type in core/types/**: AgentMode type is shared by both `agents/` and `src/`, following type layering rules
- **Plain TypeScript types for config**: No Zod schemas - this is internal state, not data crossing trust boundaries

---

## Phase 1: Core Types

### Step 1.1: Add AgentMode Type to Core

**File:** `core/types/agent-mode.ts` (new file, ~10 lines)

> **Pattern Note (Type Layering):** `AgentMode` is defined in `core/types/` because it is used by both `agents/` and `src/`. This ensures imports flow inward: `src/` -> `agents/` -> `core/`.

```typescript
/**
 * Agent interaction mode - controls how the agent handles file edits.
 * - normal: Requires user approval for file edits
 * - plan: Agent plans actions but does not execute them
 * - auto-accept: Auto-approves all file edits
 */
export type AgentMode = "normal" | "plan" | "auto-accept";
```

Export from `core/types/index.ts`:

```typescript
export type { AgentMode } from "./agent-mode.js";
```

### Step 1.2: Create Entity Types

**File:** `src/entities/agent-mode/types.ts` (~40 lines)

```typescript
import type { AgentMode } from "@core/types/agent-mode.js";

// Re-export for convenience
export type { AgentMode };

/** Ordered modes for cycling with Shift+Tab */
export const AGENT_MODE_ORDER: readonly AgentMode[] = [
  "normal",
  "plan",
  "auto-accept",
] as const;

export interface AgentModeConfig {
  label: string;
  shortLabel: string;
  description: string;
  /** CSS classes for the indicator */
  className: string;
}

export const AGENT_MODE_CONFIG: Record<AgentMode, AgentModeConfig> = {
  normal: {
    label: "Normal Mode",
    shortLabel: "Normal",
    description: "Requires approval for file edits",
    className: "text-surface-400 bg-surface-700",
  },
  plan: {
    label: "Plan Mode",
    shortLabel: "Plan",
    description: "Agent plans but does not execute",
    className: "text-secondary-400 bg-secondary-500/15",
  },
  "auto-accept": {
    label: "Auto-Accept Mode",
    shortLabel: "Auto",
    description: "Auto-approves file edits",
    className: "text-success-400 bg-success-500/15",
  },
};

/** Get the next mode in the cycle */
export function getNextMode(current: AgentMode): AgentMode {
  const currentIndex = AGENT_MODE_ORDER.indexOf(current);
  const nextIndex = (currentIndex + 1) % AGENT_MODE_ORDER.length;
  return AGENT_MODE_ORDER[nextIndex];
}
```

### Step 1.3: Create Store

**File:** `src/entities/agent-mode/store.ts` (~60 lines)

Follow the existing store pattern from `src/entities/settings/store.ts`.

```typescript
import { create } from "zustand";
import type { AgentMode } from "./types";
import { getNextMode } from "./types";

interface AgentModeState {
  /**
   * Mode per thread - each thread can have a different mode.
   * Keyed by threadId for stable references.
   */
  threadModes: Record<string, AgentMode>;

  /** Default mode for new threads */
  defaultMode: AgentMode;
}

interface AgentModeActions {
  /** Get the mode for a specific thread (defaults to defaultMode) */
  getMode: (threadId: string) => AgentMode;

  /** Set the mode for a specific thread */
  setMode: (threadId: string, mode: AgentMode) => void;

  /** Cycle to the next mode for a thread, returns the new mode */
  cycleMode: (threadId: string) => AgentMode;

  /** Set the default mode for new threads */
  setDefaultMode: (mode: AgentMode) => void;

  /** Clear mode for a thread (e.g., when thread is deleted) */
  clearThreadMode: (threadId: string) => void;
}

export const useAgentModeStore = create<AgentModeState & AgentModeActions>(
  (set, get) => ({
    // ═══════════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════════
    threadModes: {},
    defaultMode: "normal",

    // ═══════════════════════════════════════════════════════════════════════════
    // Selectors & Actions
    // ═══════════════════════════════════════════════════════════════════════════
    getMode: (threadId: string) => {
      return get().threadModes[threadId] ?? get().defaultMode;
    },

    setMode: (threadId: string, mode: AgentMode) => {
      set((state) => ({
        threadModes: { ...state.threadModes, [threadId]: mode },
      }));
    },

    cycleMode: (threadId: string) => {
      const currentMode = get().getMode(threadId);
      const nextMode = getNextMode(currentMode);
      get().setMode(threadId, nextMode);
      return nextMode;
    },

    setDefaultMode: (mode: AgentMode) => {
      set({ defaultMode: mode });
    },

    clearThreadMode: (threadId: string) => {
      set((state) => {
        const { [threadId]: _, ...rest } = state.threadModes;
        return { threadModes: rest };
      });
    },
  })
);
```

### Step 1.4: Create Index

**File:** `src/entities/agent-mode/index.ts` (~5 lines)

```typescript
export { useAgentModeStore } from "./store";
export * from "./types";
```

---

## Phase 2: UI Components

### Step 2.1: Create Mode Indicator

**File:** `src/components/simple-task/mode-indicator.tsx` (~70 lines)

Follow the pattern from `src/components/diff-viewer/file-position-indicator.tsx`.

```typescript
import { cn } from "@/lib/utils";
import type { AgentMode } from "@/entities/agent-mode";
import { AGENT_MODE_CONFIG } from "@/entities/agent-mode";

interface ModeIndicatorProps {
  mode: AgentMode;
  /** Show full label vs short label */
  variant?: "full" | "compact";
  /** Make the indicator clickable */
  onClick?: () => void;
  /** Disable interaction */
  disabled?: boolean;
  className?: string;
}

/**
 * Visual indicator for the current agent mode.
 * Shows in the thread header area.
 */
export function ModeIndicator({
  mode,
  variant = "compact",
  onClick,
  disabled = false,
  className,
}: ModeIndicatorProps) {
  const config = AGENT_MODE_CONFIG[mode];
  const label = variant === "full" ? config.label : config.shortLabel;

  const Component = onClick ? "button" : "span";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-[11px] font-medium uppercase px-2 py-0.5 rounded",
        "transition-colors [-webkit-app-region:no-drag]",
        onClick && !disabled && "cursor-pointer hover:opacity-80",
        onClick && disabled && "opacity-50 cursor-not-allowed",
        config.className,
        className
      )}
      title={config.description}
      role="status"
      aria-label={`Agent mode: ${config.label}${onClick ? ". Click to change." : ""}`}
      data-testid="mode-indicator"
      data-mode={mode}
    >
      {label}
    </Component>
  );
}

interface ModeIndicatorWithShortcutProps extends ModeIndicatorProps {
  /** Show the keyboard shortcut hint */
  showShortcut?: boolean;
}

export function ModeIndicatorWithShortcut({
  showShortcut = true,
  ...props
}: ModeIndicatorWithShortcutProps) {
  return (
    <div className="flex items-center gap-2">
      <ModeIndicator {...props} />
      {showShortcut && (
        <span className="text-[10px] text-surface-500">Shift+Tab</span>
      )}
    </div>
  );
}
```

### Step 2.2: Create Keyboard Hook

**File:** `src/components/simple-task/use-mode-keyboard.ts` (~45 lines)

Follow the pattern from `src/components/diff-viewer/use-diff-keyboard.ts`.

Note: This hook follows the React guideline of separating logic into pure functions - the actual mode cycling logic lives in the store, while this hook only handles the keyboard event binding.

```typescript
import { useCallback } from "react";
import { useAgentModeStore } from "@/entities/agent-mode";
import type { AgentMode } from "@/entities/agent-mode";

interface UseModeKeyboardOptions {
  threadId: string;
  /** Called when mode changes - use for visual feedback */
  onModeChange?: (mode: AgentMode) => void;
  /** Disable keyboard handling (e.g., when dropdown is open) */
  enabled?: boolean;
}

interface UseModeKeyboardReturn {
  /** Call this from your onKeyDown handler */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Current mode for the thread */
  currentMode: AgentMode;
}

/**
 * Hook for handling Shift+Tab mode cycling in an input component.
 *
 * This hook does NOT add global event listeners - it returns a handler
 * to be called from the input's onKeyDown prop. This allows proper
 * integration with textarea behavior (only cycle when focused).
 */
export function useModeKeyboard({
  threadId,
  onModeChange,
  enabled = true,
}: UseModeKeyboardOptions): UseModeKeyboardReturn {
  // Select specific state slices to minimize re-renders (per entity-stores pattern)
  const currentMode = useAgentModeStore((s) => s.getMode(threadId));
  const cycleMode = useAgentModeStore((s) => s.cycleMode);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;

      // Shift+Tab cycles mode
      if (e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const newMode = cycleMode(threadId);
        onModeChange?.(newMode);
      }
    },
    [enabled, threadId, cycleMode, onModeChange]
  );

  return { handleKeyDown, currentMode };
}
```

### Step 2.3: Update simple-task index.ts

**File:** `src/components/simple-task/index.ts`

Add exports for the new components:

```typescript
export { SimpleTaskWindow } from "./simple-task-window";
export { SimpleTaskHeader } from "./simple-task-header";
export { ModeIndicator, ModeIndicatorWithShortcut } from "./mode-indicator";
export { useModeKeyboard } from "./use-mode-keyboard";
```

---

## Phase 3: Integration into SimpleTaskWindow

### Step 3.1: Update SimpleTaskHeader

**File:** `src/components/simple-task/simple-task-header.tsx`

Update props interface to include threadId:

```typescript
interface SimpleTaskHeaderProps {
  taskId: string;
  threadId: string;
  status: "idle" | "loading" | "running" | "completed" | "error";
}
```

Import and integrate the indicator:

```typescript
import { ModeIndicator } from "./mode-indicator";
import { useAgentModeStore } from "@/entities/agent-mode";

export function SimpleTaskHeader({ taskId, threadId, status }: SimpleTaskHeaderProps) {
  const currentMode = useAgentModeStore((s) => s.getMode(threadId));
  const cycleMode = useAgentModeStore((s) => s.cycleMode);

  const handleToggle = () => {
    cycleMode(threadId);
  };

  const isStreaming = status === "running";

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-800 border-b border-surface-700 [-webkit-app-region:drag]">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-surface-400">{taskId.slice(0, 8)}...</span>
        <span className={cn("text-[11px] font-medium uppercase px-2 py-0.5 rounded", statusStyles[status])}>
          {status}
        </span>
      </div>
      <ModeIndicator
        mode={currentMode}
        onClick={handleToggle}
        disabled={isStreaming}
      />
    </div>
  );
}
```

### Step 3.2: Update SimpleTaskWindow

**File:** `src/components/simple-task/simple-task-window.tsx`

Pass `threadId` to header (around line 94):

```typescript
<SimpleTaskHeader taskId={taskId} threadId={threadId} status={viewStatus} />
```

### Step 3.3: Integrate into ThreadInput

**File:** `src/components/reusable/thread-input.tsx`

Modify the existing ThreadInput component to support mode switching.

**Changes needed:**
1. Accept `threadId` prop
2. Import and use `useModeKeyboard` hook
3. Add `ModeIndicatorWithShortcut` to the input area
4. Call `handleKeyDown` from the hook in addition to existing handler

```typescript
// Add to imports
import { useModeKeyboard } from "@/components/simple-task/use-mode-keyboard";
import { ModeIndicatorWithShortcut } from "@/components/simple-task/mode-indicator";

// Add threadId to props
interface ThreadInputProps {
  threadId: string;  // NEW
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;
  placeholder?: string;
}

// Inside component, add the hook
const { handleKeyDown: handleModeKeyDown, currentMode } = useModeKeyboard({
  threadId,
  enabled: !disabled,
});

// Modify handleKeyDown to chain both handlers
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Check for mode switching first
    handleModeKeyDown(e);
    if (e.defaultPrevented) return;

    // Existing Cmd+Enter handling...
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
      return;
    }
  },
  [handleModeKeyDown, handleSubmit]
);

// Add ModeIndicator to the JSX (before the Send button)
<div className="flex items-center gap-2 self-end">
  <ModeIndicatorWithShortcut mode={currentMode} />
  <button ...>Send</button>
</div>
```

---

## Phase 4: Agent Integration

> **Pattern Note (Agent Process Architecture):** This phase passes the mode to the Node agent process. Per docs/agents.md, business logic belongs in the agent process - the UI simply communicates the user's preference, and the agent enforces it.

### Step 4.1: Update RunnerConfig Type

**File:** `agents/src/runners/types.ts`

Add to `RunnerConfig` interface:

```typescript
import type { AgentMode } from "@core/types/agent-mode.js";

// ... in interface RunnerConfig
/** Agent mode for tool execution */
agentMode?: AgentMode;
```

> **Pattern Note (Type Layering):** Agents import from `@core/types/` (not `@/`). This maintains the correct import direction.

### Step 4.2: Update resumeSimpleAgent

**File:** `src/lib/agent-service.ts`

Update function signature:

```typescript
import type { AgentMode } from "@core/types/agent-mode.js";

export async function resumeSimpleAgent(
  taskId: string,
  threadId: string,
  prompt: string,
  sourcePath: string,
  agentMode: AgentMode = "normal",
): Promise<void> {
```

Add CLI arg:

```typescript
const commandArgs = [
  runnerPath,
  "--agent", "simple",
  "--task-id", taskId,
  "--thread-id", threadId,
  "--cwd", sourcePath,
  "--prompt", prompt,
  "--mort-dir", mortDir,
  "--agent-mode", agentMode,  // ADD THIS
  "--history-file", stateFilePath,
];
```

Also update `spawnSimpleAgent` similarly.

### Step 4.3: Parse Agent Mode in SimpleRunnerStrategy

**File:** `agents/src/runners/simple-runner-strategy.ts`

Add case in `parseArgs`:

```typescript
case "--agent-mode":
  config.agentMode = args[++i] as AgentMode;
  break;
```

Default to `normal` if not provided.

### Step 4.4: Pass Agent Mode to Agent Loop

**File:** `agents/src/runners/shared.ts`

Update `runAgentLoop` function signature:

```typescript
export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,
  agentConfig: AgentConfig,
  priorMessages: MessageParam[] = [],
  options: AgentLoopOptions = {}
): Promise<void> {
```

Then use `config.agentMode ?? "normal"` in the `query()` call to determine permission behavior.

---

## Phase 5: Wire Up UI to Agent

### Step 5.1: Update SimpleTaskWindow handleSubmit

**File:** `src/components/simple-task/simple-task-window.tsx`

Update the handler:

```typescript
import { useAgentModeStore } from "@/entities/agent-mode";

// Inside component
const agentMode = useAgentModeStore((s) => s.getMode(threadId));

const handleSubmit = async (prompt: string) => {
  if (!workingDirectory) {
    logger.error("[SimpleTaskWindow] Cannot resume: no working directory");
    return;
  }
  await resumeSimpleAgent(taskId, threadId, prompt, workingDirectory, agentMode);
};
```

---

## Testing Plan

> **Pattern Note (Testing):** Per docs/testing.md, all code must be verified with tests. This plan includes unit tests for the store and types, UI isolation tests for components (using `.ui.test.tsx` suffix), and integration tests for CLI argument parsing.

### Unit Tests for Types

**File:** `src/entities/agent-mode/types.test.ts` (~30 lines)

```typescript
import { describe, it, expect } from "vitest";
import { getNextMode, AGENT_MODE_ORDER } from "./types";

describe("getNextMode", () => {
  it("cycles through modes in order", () => {
    expect(getNextMode("normal")).toBe("plan");
    expect(getNextMode("plan")).toBe("auto-accept");
    expect(getNextMode("auto-accept")).toBe("normal");
  });

  it("mode order matches expected sequence", () => {
    expect(AGENT_MODE_ORDER).toEqual(["normal", "plan", "auto-accept"]);
  });
});
```

### Unit Tests for Store

**File:** `src/entities/agent-mode/store.test.ts` (~100 lines)

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useAgentModeStore } from "./store";
import type { AgentMode } from "./types";

describe("AgentMode Store", () => {
  beforeEach(() => {
    // Reset store to default state
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  describe("getMode", () => {
    it("returns default mode when thread has no specific mode", () => {
      const mode = useAgentModeStore.getState().getMode("thread-1");
      expect(mode).toBe("normal");
    });

    it("returns thread-specific mode when set", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");
      const mode = useAgentModeStore.getState().getMode("thread-1");
      expect(mode).toBe("plan");
    });

    it("returns different modes for different threads", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");
      useAgentModeStore.getState().setMode("thread-2", "auto-accept");

      expect(useAgentModeStore.getState().getMode("thread-1")).toBe("plan");
      expect(useAgentModeStore.getState().getMode("thread-2")).toBe("auto-accept");
    });
  });

  describe("cycleMode", () => {
    it("cycles normal -> plan -> auto-accept -> normal", () => {
      const threadId = "test-thread";

      expect(useAgentModeStore.getState().getMode(threadId)).toBe("normal");

      let newMode = useAgentModeStore.getState().cycleMode(threadId);
      expect(newMode).toBe("plan");
      expect(useAgentModeStore.getState().getMode(threadId)).toBe("plan");

      newMode = useAgentModeStore.getState().cycleMode(threadId);
      expect(newMode).toBe("auto-accept");
      expect(useAgentModeStore.getState().getMode(threadId)).toBe("auto-accept");

      newMode = useAgentModeStore.getState().cycleMode(threadId);
      expect(newMode).toBe("normal");
      expect(useAgentModeStore.getState().getMode(threadId)).toBe("normal");
    });

    it("returns the new mode after cycling", () => {
      const newMode = useAgentModeStore.getState().cycleMode("thread-1");
      expect(newMode).toBe("plan");
    });
  });

  describe("setDefaultMode", () => {
    it("changes the default mode for new threads", () => {
      useAgentModeStore.getState().setDefaultMode("auto-accept");
      expect(useAgentModeStore.getState().getMode("new-thread")).toBe("auto-accept");
    });

    it("does not affect threads with explicit modes", () => {
      useAgentModeStore.getState().setMode("thread-1", "plan");
      useAgentModeStore.getState().setDefaultMode("auto-accept");
      expect(useAgentModeStore.getState().getMode("thread-1")).toBe("plan");
    });
  });

  describe("clearThreadMode", () => {
    it("removes thread-specific mode, falling back to default", () => {
      useAgentModeStore.getState().setMode("thread-1", "auto-accept");
      useAgentModeStore.getState().clearThreadMode("thread-1");
      expect(useAgentModeStore.getState().getMode("thread-1")).toBe("normal");
    });

    it("does nothing for threads without explicit mode", () => {
      useAgentModeStore.getState().clearThreadMode("nonexistent");
      // Should not throw
      expect(useAgentModeStore.getState().getMode("nonexistent")).toBe("normal");
    });
  });
});
```

### UI Tests for ModeIndicator

**File:** `src/components/simple-task/mode-indicator.ui.test.tsx` (~100 lines)

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { ModeIndicator, ModeIndicatorWithShortcut } from "./mode-indicator";

describe("ModeIndicator UI", () => {
  describe("rendering modes", () => {
    it("renders normal mode with correct styling", () => {
      render(<ModeIndicator mode="normal" />);

      const indicator = screen.getByRole("status");
      expect(indicator).toHaveTextContent("Normal");
      expect(indicator).toHaveClass("text-surface-400");
    });

    it("renders plan mode with secondary styling", () => {
      render(<ModeIndicator mode="plan" />);

      const indicator = screen.getByRole("status");
      expect(indicator).toHaveTextContent("Plan");
      expect(indicator).toHaveClass("text-secondary-400");
    });

    it("renders auto-accept mode with success styling", () => {
      render(<ModeIndicator mode="auto-accept" />);

      const indicator = screen.getByRole("status");
      expect(indicator).toHaveTextContent("Auto");
      expect(indicator).toHaveClass("text-success-400");
    });
  });

  describe("variants", () => {
    it("shows short label by default (compact variant)", () => {
      render(<ModeIndicator mode="auto-accept" variant="compact" />);
      expect(screen.getByRole("status")).toHaveTextContent("Auto");
    });

    it("shows full label with full variant", () => {
      render(<ModeIndicator mode="auto-accept" variant="full" />);
      expect(screen.getByRole("status")).toHaveTextContent("Auto-Accept Mode");
    });
  });

  describe("interaction", () => {
    it("calls onClick when clicked", () => {
      const onClick = vi.fn();
      render(<ModeIndicator mode="normal" onClick={onClick} />);

      fireEvent.click(screen.getByRole("status"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("does not call onClick when disabled", () => {
      const onClick = vi.fn();
      render(<ModeIndicator mode="normal" onClick={onClick} disabled />);

      fireEvent.click(screen.getByRole("status"));
      expect(onClick).not.toHaveBeenCalled();
    });

    it("renders as button when onClick provided", () => {
      render(<ModeIndicator mode="normal" onClick={() => {}} />);
      expect(screen.getByRole("status").tagName).toBe("BUTTON");
    });

    it("renders as span when onClick not provided", () => {
      render(<ModeIndicator mode="normal" />);
      expect(screen.getByRole("status").tagName).toBe("SPAN");
    });
  });

  describe("accessibility", () => {
    it("has proper aria-label without onClick", () => {
      render(<ModeIndicator mode="plan" />);

      const indicator = screen.getByRole("status");
      expect(indicator).toHaveAttribute("aria-label", "Agent mode: Plan Mode");
    });

    it("has proper aria-label with onClick", () => {
      render(<ModeIndicator mode="plan" onClick={() => {}} />);

      const indicator = screen.getByRole("status");
      expect(indicator).toHaveAttribute("aria-label", "Agent mode: Plan Mode. Click to change.");
    });

    it("has title with description for tooltip", () => {
      render(<ModeIndicator mode="plan" />);

      const indicator = screen.getByRole("status");
      expect(indicator).toHaveAttribute("title", "Agent plans but does not execute");
    });
  });
});

describe("ModeIndicatorWithShortcut UI", () => {
  it("shows shortcut hint by default", () => {
    render(<ModeIndicatorWithShortcut mode="normal" />);

    expect(screen.getByText("Shift+Tab")).toBeInTheDocument();
  });

  it("hides shortcut hint when showShortcut is false", () => {
    render(<ModeIndicatorWithShortcut mode="normal" showShortcut={false} />);

    expect(screen.queryByText("Shift+Tab")).not.toBeInTheDocument();
  });
});
```

### UI Tests for Keyboard Hook

**File:** `src/components/simple-task/use-mode-keyboard.ui.test.tsx` (~100 lines)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { useModeKeyboard } from "./use-mode-keyboard";
import { useAgentModeStore } from "@/entities/agent-mode";

// Test component that uses the hook
function TestInput({ threadId, onModeChange }: {
  threadId: string;
  onModeChange?: (mode: string) => void;
}) {
  const { handleKeyDown, currentMode } = useModeKeyboard({
    threadId,
    onModeChange,
  });

  return (
    <div>
      <textarea
        data-testid="test-input"
        onKeyDown={handleKeyDown}
      />
      <span data-testid="current-mode">{currentMode}</span>
    </div>
  );
}

describe("useModeKeyboard", () => {
  beforeEach(() => {
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  it("cycles mode on Shift+Tab", () => {
    render(<TestInput threadId="thread-1" />);

    const input = screen.getByTestId("test-input");

    // Initial mode is normal
    expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");

    // Press Shift+Tab
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

    // Mode should be plan
    expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");
  });

  it("calls onModeChange callback with new mode", () => {
    const onModeChange = vi.fn();
    render(<TestInput threadId="thread-1" onModeChange={onModeChange} />);

    const input = screen.getByTestId("test-input");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });

    expect(onModeChange).toHaveBeenCalledWith("plan");
  });

  it("does not cycle on Tab without Shift", () => {
    render(<TestInput threadId="thread-1" />);

    const input = screen.getByTestId("test-input");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: false });

    // Mode should still be normal
    expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");
  });

  it("does not cycle on other key combinations", () => {
    render(<TestInput threadId="thread-1" />);

    const input = screen.getByTestId("test-input");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");

    fireEvent.keyDown(input, { key: "a", shiftKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");
  });

  it("maintains separate modes per thread", () => {
    const { rerender } = render(<TestInput threadId="thread-1" />);

    const input = screen.getByTestId("test-input");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("plan");

    // Render with different thread
    rerender(<TestInput threadId="thread-2" />);
    expect(screen.getByTestId("current-mode")).toHaveTextContent("normal");
  });
});
```

### Integration Test: ThreadInput with Mode Switching

**File:** `src/components/reusable/thread-input.ui.test.tsx` (~120 lines)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/helpers";
import { ThreadInput } from "./thread-input";
import { useAgentModeStore } from "@/entities/agent-mode";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("ThreadInput with Mode Switching", () => {
  const mockOnSubmit = vi.fn();
  const defaultProps = {
    threadId: "test-thread-123",
    onSubmit: mockOnSubmit,
    workingDirectory: "/test/repo",
  };

  beforeEach(() => {
    mockOnSubmit.mockClear();
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  describe("mode indicator display", () => {
    it("shows mode indicator with current mode", () => {
      render(<ThreadInput {...defaultProps} />);

      expect(screen.getByRole("status")).toHaveTextContent("Normal");
    });

    it("shows shortcut hint", () => {
      render(<ThreadInput {...defaultProps} />);

      expect(screen.getByText("Shift+Tab")).toBeInTheDocument();
    });

    it("updates indicator when mode changes", () => {
      render(<ThreadInput {...defaultProps} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });

      expect(screen.getByRole("status")).toHaveTextContent("Plan");
    });
  });

  describe("keyboard interaction", () => {
    it("cycles through all modes", () => {
      render(<ThreadInput {...defaultProps} />);

      const textarea = screen.getByRole("textbox");
      const indicator = screen.getByRole("status");

      expect(indicator).toHaveTextContent("Normal");

      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Plan");

      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Auto");

      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Normal");
    });

    it("does not interfere with Cmd+Enter submit", async () => {
      render(<ThreadInput {...defaultProps} />);

      const textarea = screen.getByRole("textbox");

      // Type a message
      fireEvent.change(textarea, { target: { value: "test message" } });

      // Submit with Cmd+Enter
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

      expect(mockOnSubmit).toHaveBeenCalledWith("test message");
    });

    it("does not cycle mode when disabled", () => {
      render(<ThreadInput {...defaultProps} disabled />);

      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });

      // Should still be normal (not cycled)
      expect(screen.getByRole("status")).toHaveTextContent("Normal");
    });
  });

  describe("mode persistence per thread", () => {
    it("remembers mode when re-rendered with same threadId", () => {
      const { rerender } = render(<ThreadInput {...defaultProps} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(screen.getByRole("status")).toHaveTextContent("Plan");

      // Re-render same component
      rerender(<ThreadInput {...defaultProps} />);

      // Should still be plan mode
      expect(screen.getByRole("status")).toHaveTextContent("Plan");
    });

    it("shows default mode for different threadId", () => {
      const { rerender } = render(<ThreadInput {...defaultProps} />);

      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(screen.getByRole("status")).toHaveTextContent("Plan");

      // Render with different thread
      rerender(<ThreadInput {...defaultProps} threadId="other-thread" />);

      // Should be normal (default for new thread)
      expect(screen.getByRole("status")).toHaveTextContent("Normal");
    });
  });
});
```

### Integration Test: SimpleTaskHeader

**File:** `src/components/simple-task/simple-task-header.ui.test.tsx` (~60 lines)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { SimpleTaskHeader } from "./simple-task-header";
import { useAgentModeStore } from "@/entities/agent-mode";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe("SimpleTaskHeader", () => {
  beforeEach(() => {
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  it("displays the mode indicator", () => {
    render(
      <SimpleTaskHeader
        taskId="task-123"
        threadId="thread-456"
        status="idle"
      />
    );

    expect(screen.getByTestId("mode-indicator")).toBeInTheDocument();
  });

  it("toggles mode through all states", () => {
    render(
      <SimpleTaskHeader
        taskId="task-123"
        threadId="thread-456"
        status="idle"
      />
    );

    const indicator = screen.getByTestId("mode-indicator");

    // Default is normal
    expect(indicator).toHaveAttribute("data-mode", "normal");

    // Click: normal -> plan
    fireEvent.click(indicator);
    expect(indicator).toHaveAttribute("data-mode", "plan");

    // Click: plan -> auto-accept
    fireEvent.click(indicator);
    expect(indicator).toHaveAttribute("data-mode", "auto-accept");

    // Click: auto-accept -> normal
    fireEvent.click(indicator);
    expect(indicator).toHaveAttribute("data-mode", "normal");
  });

  it("disables indicator when status is running", () => {
    render(
      <SimpleTaskHeader
        taskId="task-123"
        threadId="thread-456"
        status="running"
      />
    );

    expect(screen.getByTestId("mode-indicator")).toBeDisabled();
  });
});
```

### Agent Integration Tests

**File:** `agents/src/runners/simple-runner-strategy.test.ts`

Add test case:

```typescript
describe("parseArgs", () => {
  it("parses --agent-mode argument", () => {
    const strategy = new SimpleRunnerStrategy();
    const config = strategy.parseArgs([
      "--agent", "simple",
      "--task-id", "task-123",
      "--thread-id", "thread-456",
      "--cwd", "/tmp/test",
      "--mort-dir", "/tmp/mort",
      "--prompt", "test prompt",
      "--agent-mode", "auto-accept",
    ]);

    expect(config.agentMode).toBe("auto-accept");
  });

  it("defaults agentMode to undefined when not provided", () => {
    const strategy = new SimpleRunnerStrategy();
    const config = strategy.parseArgs([
      "--agent", "simple",
      "--task-id", "task-123",
      "--thread-id", "thread-456",
      "--cwd", "/tmp/test",
      "--mort-dir", "/tmp/mort",
      "--prompt", "test prompt",
    ]);

    expect(config.agentMode).toBeUndefined();
  });
});
```

---

## Edge Cases to Test

### Store Edge Cases
- [ ] Thread ID with special characters (ensure no key issues)
- [ ] Calling `clearThreadMode` multiple times on same thread
- [ ] Calling `cycleMode` immediately after `setDefaultMode`
- [ ] Store behavior with empty string threadId

### UI Edge Cases
- [ ] Rapid repeated Shift+Tab (debounce behavior if needed)
- [ ] Shift+Tab while trigger dropdown is open (should not conflict)
- [ ] Mode indicator with very long custom labels (layout)
- [ ] Screen reader announcement when mode changes

### Integration Edge Cases
- [ ] Mode state when thread is deleted
- [ ] Mode state when switching between windows
- [ ] Mode indication when agent is streaming (disabled state)
- [ ] Mode change during streaming (should be disabled)

---

## Manual Testing Checklist

- [ ] Open simple task window
- [ ] Verify indicator shows "Normal" by default (gray)
- [ ] Press Shift+Tab in input - should cycle to "Plan" (blue)
- [ ] Press Shift+Tab again - should cycle to "Auto" (green)
- [ ] Press Shift+Tab again - should cycle back to "Normal"
- [ ] Click indicator in header - should also cycle modes
- [ ] Verify clicking/Shift+Tab while streaming is disabled
- [ ] Submit a prompt with different modes
- [ ] Verify agent respects the mode (may require actual tool use)
- [ ] Open different thread - verify mode is independent
- [ ] Close and reopen window - verify mode resets (not persisted)

---

## Future Considerations

### Not In Scope (YAGNI)

Per the YAGNI pattern: delete dead code aggressively, don't build speculative features.

- Persisting mode preferences to disk (modes are ephemeral per session)
- Global mode toggle (all threads at once)
- Mode presets or custom modes
- Mode history/undo
- Reverse cycling with Shift+Ctrl+Tab (add only if users request it)

### Later Phases

1. **Safety guardrails**: Even in auto-accept mode, certain operations should trigger warnings:
   - File deletion: Show toast notification
   - Git operations: Warn before force push, reset, rebase
   - System commands: Flag commands that modify system state

2. **Visual feedback**: Toast or flash when mode changes (optional UX enhancement)

3. **Settings integration**: Default mode in settings (only if users need different defaults)

---

## Verification Checklist

Per docs/testing.md - all code must be verifiable with tests and type checking.

- [ ] `pnpm tsc --noEmit` passes (frontend types)
- [ ] `pnpm test` passes (new unit tests in `src/entities/agent-mode/*.test.ts`)
- [ ] `pnpm test:ui` passes (new UI tests with `.ui.test.tsx` suffix)
- [ ] Manual test: Shift+Tab cycles modes visually
- [ ] Manual test: Click indicator cycles modes
- [ ] Manual test: Mode persists per thread in same session
- [ ] Manual test: Mode indicator visible and accessible
- [ ] Code review: Files under 250 lines, functions under 50 lines (per agents.md)

---

## File Summary

| File | Action | Lines |
|------|--------|-------|
| `core/types/agent-mode.ts` | Create | ~10 |
| `core/types/index.ts` | Modify | +1 |
| `src/entities/agent-mode/types.ts` | Create | ~40 |
| `src/entities/agent-mode/store.ts` | Create | ~60 |
| `src/entities/agent-mode/index.ts` | Create | ~5 |
| `src/components/simple-task/mode-indicator.tsx` | Create | ~70 |
| `src/components/simple-task/use-mode-keyboard.ts` | Create | ~45 |
| `src/components/simple-task/index.ts` | Modify | +3 |
| `src/components/simple-task/simple-task-header.tsx` | Modify | +15 |
| `src/components/simple-task/simple-task-window.tsx` | Modify | +5 |
| `src/components/reusable/thread-input.tsx` | Modify | +20 |
| `agents/src/runners/types.ts` | Modify | +3 |
| `agents/src/runners/simple-runner-strategy.ts` | Modify | +5 |
| `agents/src/runners/shared.ts` | Modify | +2 |
| `src/lib/agent-service.ts` | Modify | +5 |

### Test Files

| File | Lines |
|------|-------|
| `src/entities/agent-mode/types.test.ts` | ~30 |
| `src/entities/agent-mode/store.test.ts` | ~100 |
| `src/components/simple-task/mode-indicator.ui.test.tsx` | ~100 |
| `src/components/simple-task/use-mode-keyboard.ui.test.tsx` | ~100 |
| `src/components/simple-task/simple-task-header.ui.test.tsx` | ~60 |
| `src/components/reusable/thread-input.ui.test.tsx` | ~120 |

---

## Implementation Order

1. **Phase 1:** Core types (can test in isolation)
2. **Phase 2:** UI components (can test with mocked store)
3. **Phase 3:** Integration into SimpleTaskWindow (visual verification)
4. **Phase 4:** Agent integration (requires running agents)
5. **Phase 5:** Wire up UI to agent (end-to-end verification)

Each phase should have passing tests before moving to the next.

---

## Pattern Compliance Summary

| Pattern | Status | Notes |
|---------|--------|-------|
| **Entity Stores** | Compliant | Single store keyed by threadId, specific selectors to minimize re-renders |
| **Disk as Truth** | N/A | Ephemeral UI state - not persisted to disk by design |
| **Event Bridge** | N/A | No cross-process events needed - UI-only feature |
| **YAGNI** | Compliant | Explicitly defers persistence, global toggle, presets to "later phases" |
| **Zod at Boundaries** | Compliant | Plain TypeScript types - no external data boundaries |
| **Type Layering** | Compliant | `AgentMode` in `core/types/`, imports flow inward |
| **Adapters** | N/A | No platform-specific operations |
| **File Size Limits** | Compliant | All files estimated under 250 lines |
| **Function Size Limits** | Compliant | All functions under 50 lines |
| **Stable References** | Compliant | Keyed by threadId, not slugs or paths |
| **Testing** | Compliant | Unit tests + UI isolation tests with proper suffixes |
| **Logging** | Compliant | Uses `logger` import pattern (shown in test mocks) |
| **React Guidelines** | Compliant | Logic in store/pure functions, hooks handle event binding only |
