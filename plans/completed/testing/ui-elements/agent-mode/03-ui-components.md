# Sub-Plan 03: UI Components

## Overview
Create the ModeIndicator component and useModeKeyboard hook for visual display and keyboard interaction with agent modes.

## Dependencies
- **02-entity-types-and-store.md** - Requires types and store from entity

## Can Run In Parallel With
- **04-agent-integration.md** - These can run in parallel as they don't share files

## Scope
- Create ModeIndicator component with variants
- Create useModeKeyboard hook for Shift+Tab handling
- Update simple-task index exports

## Files Involved

### New Files
| File | Lines |
|------|-------|
| `src/components/simple-task/mode-indicator.tsx` | ~70 |
| `src/components/simple-task/use-mode-keyboard.ts` | ~45 |

### Modified Files
| File | Change |
|------|--------|
| `src/components/simple-task/index.ts` | Add exports for new components |

### Test Files
| File | Lines |
|------|-------|
| `src/components/simple-task/mode-indicator.ui.test.tsx` | ~100 |
| `src/components/simple-task/use-mode-keyboard.ui.test.tsx` | ~100 |

## Implementation Details

### Step 1: Create Mode Indicator

**File:** `src/components/simple-task/mode-indicator.tsx`

```typescript
import { cn } from "@/lib/utils";
import type { AgentMode } from "@/entities/agent-mode";
import { AGENT_MODE_CONFIG } from "@/entities/agent-mode";

interface ModeIndicatorProps {
  mode: AgentMode;
  variant?: "full" | "compact";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

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
        // Transition classes for visual feedback on mode change
        "transition-all duration-150 ease-in-out [-webkit-app-region:no-drag]",
        onClick && !disabled && "cursor-pointer hover:opacity-80 active:scale-95",
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

### Step 2: Create Keyboard Hook

**File:** `src/components/simple-task/use-mode-keyboard.ts`

```typescript
import { useCallback, useMemo } from "react";
import { useAgentModeStore } from "@/entities/agent-mode";
import type { AgentMode } from "@/entities/agent-mode";

interface UseModeKeyboardOptions {
  threadId: string;
  onModeChange?: (mode: AgentMode) => void;
  enabled?: boolean;
}

interface UseModeKeyboardReturn {
  handleKeyDown: (e: React.KeyboardEvent) => void;
  currentMode: AgentMode;
}

export function useModeKeyboard({
  threadId,
  onModeChange,
  enabled = true,
}: UseModeKeyboardOptions): UseModeKeyboardReturn {
  // NOTE: Selector stability - create stable selector to avoid unnecessary re-renders
  // The getMode function from store already handles the threadId lookup internally,
  // but we wrap it in useMemo to ensure the selector reference is stable
  const selectMode = useMemo(
    () => (s: ReturnType<typeof useAgentModeStore.getState>) => s.getMode(threadId),
    [threadId]
  );
  const currentMode = useAgentModeStore(selectMode);
  const cycleMode = useAgentModeStore((s) => s.cycleMode);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;

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

> **Note on Selector Stability:** When using Zustand selectors that depend on external values (like `threadId`), ensure the selector function reference is stable using `useMemo`. This prevents unnecessary re-subscriptions and re-renders when the component updates for unrelated reasons.

### Step 3: Update Index Exports

**File:** `src/components/simple-task/index.ts`

Add:
```typescript
export { ModeIndicator, ModeIndicatorWithShortcut } from "./mode-indicator";
export { useModeKeyboard } from "./use-mode-keyboard";
```

## Tests Required

### mode-indicator.ui.test.tsx
- Test rendering each mode with correct styling
- Test compact vs full variants
- Test onClick interaction
- Test disabled state
- Test accessibility attributes

### use-mode-keyboard.ui.test.tsx
- Test Shift+Tab cycles mode
- Test callback is called with new mode
- Test Tab without Shift does not cycle
- Test other key combinations are ignored
- Test per-thread mode isolation

## Verification
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test:ui src/components/simple-task/mode-indicator` passes
- [ ] `pnpm test:ui src/components/simple-task/use-mode-keyboard` passes

## Estimated Time
~45 minutes
