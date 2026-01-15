# Sub-Plan 02: Entity Types and Store

## Overview
Create the agent-mode entity with types, configuration constants, helper functions, and Zustand store for managing per-thread mode state.

## Dependencies
- **01-core-types.md** - Requires AgentMode type from `core/types/`

## Can Run In Parallel With
- After 01 completes: Can run in parallel with 03-ui-components.md (once this is done)

## Scope
- Create entity types with mode configuration
- Create Zustand store for thread-specific mode state
- Create index exports

## Files Involved

### New Files
| File | Lines |
|------|-------|
| `src/entities/agent-mode/types.ts` | ~40 |
| `src/entities/agent-mode/store.ts` | ~60 |
| `src/entities/agent-mode/index.ts` | ~5 |

### Test Files
| File | Lines |
|------|-------|
| `src/entities/agent-mode/types.test.ts` | ~30 |
| `src/entities/agent-mode/store.test.ts` | ~100 |

## Implementation Details

### Step 1: Create Entity Types

**File:** `src/entities/agent-mode/types.ts`

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

### Step 2: Create Store

**File:** `src/entities/agent-mode/store.ts`

```typescript
import { create } from "zustand";
import type { AgentMode } from "./types";
import { getNextMode } from "./types";

interface AgentModeState {
  threadModes: Record<string, AgentMode>;
  defaultMode: AgentMode;
}

interface AgentModeActions {
  getMode: (threadId: string) => AgentMode;
  setMode: (threadId: string, mode: AgentMode) => void;
  cycleMode: (threadId: string) => AgentMode;
  setDefaultMode: (mode: AgentMode) => void;
  clearThreadMode: (threadId: string) => void;
}

export const useAgentModeStore = create<AgentModeState & AgentModeActions>(
  (set, get) => ({
    threadModes: {},
    defaultMode: "normal",

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

### Step 3: Create Index

**File:** `src/entities/agent-mode/index.ts`

```typescript
export { useAgentModeStore } from "./store";
export * from "./types";
```

### Optional: Selector Pattern for Cleaner Usage

For cleaner component usage, consider adding pre-built selector hooks that encapsulate the store access pattern. This can be added to the index or a separate `selectors.ts` file:

```typescript
// src/entities/agent-mode/selectors.ts
import { useAgentModeStore } from "./store";
import type { AgentMode } from "./types";

/**
 * Hook to get the current mode for a specific thread.
 * Encapsulates the selector pattern for cleaner component usage.
 */
export function useThreadMode(threadId: string): AgentMode {
  return useAgentModeStore((s) => s.getMode(threadId));
}

/**
 * Hook to get the cycle function for mode changes.
 * Returns a stable function reference.
 */
export function useCycleMode(): (threadId: string) => AgentMode {
  return useAgentModeStore((s) => s.cycleMode);
}
```

This pattern provides:
1. **Simpler component code:** `const mode = useThreadMode(threadId)` vs `useAgentModeStore((s) => s.getMode(threadId))`
2. **Centralized selector logic:** Changes to how mode is retrieved only need updates in one place
3. **Better testability:** Selectors can be tested in isolation

> **Note:** If this pattern is adopted, update the imports in UI components (Sub-Plans 03, 05, 06) to use these selectors instead of direct store access.

## Tests Required

### types.test.ts
- Test `getNextMode` cycles through modes correctly
- Test `AGENT_MODE_ORDER` has expected sequence

### store.test.ts
- Test `getMode` returns default when thread has no mode
- Test `getMode` returns thread-specific mode when set
- Test `setMode` sets mode for specific thread
- Test `cycleMode` cycles through all modes
- Test `setDefaultMode` changes default for new threads
- Test `clearThreadMode` removes thread mode

## Verification
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test src/entities/agent-mode` passes
- [ ] Store can be imported and used

## Estimated Time
~30 minutes
