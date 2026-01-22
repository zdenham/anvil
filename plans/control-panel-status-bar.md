# Control Panel Status Bar

## Overview

Add a status bar below the input in the control panel that displays:
1. **Permission mode indicator** (left side) - Shows current permission mode with toggle support for future
2. **Token usage counter** (right side) - Shows tokens used out of 200k context window

## Current State Analysis

### Permission Mode
- Permission mode is defined in `core/types/permissions.ts` with values: `"ask-always"`, `"ask-writes"`, `"allow-all"`
- Currently hardcoded to `bypassPermissions` in `agents/src/runners/shared.ts` line 411
- Full permission UI infrastructure exists in `src/entities/permissions/` and `src/components/permission/`
- Mode is set per-agent run via `OrchestrationContext.permissionMode`

### Token Usage
- SDK provides token data in `SDKAssistantMessage.message.usage` and `SDKResultMessage.usage`:
  - `input_tokens`, `output_tokens`
  - `cache_creation_input_tokens`, `cache_read_input_tokens`
- Currently only `totalCostUsd`, `durationApiMs`, `numTurns` are extracted from SDK messages
- `ResultMetricsSchema` in `core/types/events.ts` needs extension for token counts
- Token data flows through `MessageHandler.handleResult()` → `complete()` → `ThreadState.metrics`

### Control Panel Layout
- Input component: `src/components/reusable/thread-input.tsx`
- Main layout: `src/components/control-panel/control-panel-window.tsx`
- Layout order (bottom up): ThreadInput → SuggestedActionsPanel → Content → Header
- Design tokens: `bg-surface-800`, `border-surface-700`, `px-4 py-2`, `text-xs`

## Implementation Plan

### Phase 1: Extend Token Tracking in Agent Layer

**File: `core/types/events.ts`**

Extend `ResultMetricsSchema` to include token counts:

```typescript
export const ResultMetricsSchema = z.object({
  durationApiMs: z.number(),
  totalCostUsd: z.number(),
  numTurns: z.number(),
  // New fields
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
});
```

**File: `agents/src/runners/message-handler.ts`**

Update `handleResult()` to extract token usage from SDK result message:

```typescript
case "success":
  await complete({
    durationApiMs: msg.duration_api_ms,
    totalCostUsd: msg.total_cost_usd,
    numTurns: msg.num_turns,
    // Add token extraction
    inputTokens: msg.usage?.input_tokens,
    outputTokens: msg.usage?.output_tokens,
    cacheReadTokens: msg.usage?.cache_read_input_tokens ?? undefined,
    cacheCreationTokens: msg.usage?.cache_creation_input_tokens ?? undefined,
  });
```

### Phase 2: Track Live Token Usage During Streaming

The result message only arrives at the end. For live updates, we need to accumulate tokens from assistant messages.

**File: `agents/src/runners/message-handler.ts`**

Add token accumulation in `handleAssistant()`:

```typescript
private accumulatedTokens = { input: 0, output: 0 };

private async handleAssistant(msg: SDKAssistantMessage): Promise<boolean> {
  // Accumulate tokens from each assistant message
  if (msg.message.usage) {
    this.accumulatedTokens.input += msg.message.usage.input_tokens;
    this.accumulatedTokens.output += msg.message.usage.output_tokens;
  }
  // Emit token update event
  emitEvent(EventName.TOKEN_USAGE_UPDATE, {
    threadId: this.threadId,
    inputTokens: this.accumulatedTokens.input,
    outputTokens: this.accumulatedTokens.output,
  });
  // ... existing logic
}
```

**File: `core/types/events.ts`**

Add new event type:

```typescript
[EventName.TOKEN_USAGE_UPDATE]: {
  threadId: string;
  inputTokens: number;
  outputTokens: number;
};
```

### Phase 3: Create Status Bar Component

**File: `src/components/control-panel/status-bar.tsx` (new)**

```tsx
interface StatusBarProps {
  threadId: string | null;
}

export function StatusBar({ threadId }: StatusBarProps) {
  const permissionMode = usePermissionMode();
  const { inputTokens, outputTokens } = useTokenUsage(threadId);

  const totalTokens = inputTokens + outputTokens;
  const maxTokens = 200_000;

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-surface-800 border-t border-surface-700 text-xs text-surface-400">
      {/* Left: Permission Mode */}
      <PermissionModeIndicator mode={permissionMode} />

      {/* Right: Token Usage */}
      <div className="flex items-center gap-1.5">
        <span className={totalTokens > maxTokens * 0.9 ? "text-amber-400" : ""}>
          {formatTokenCount(totalTokens)}
        </span>
        <span className="text-surface-500">/</span>
        <span className="text-surface-500">200k</span>
      </div>
    </div>
  );
}
```

### Phase 4: Permission Mode Indicator Component

**File: `src/components/control-panel/permission-mode-indicator.tsx` (new)**

```tsx
interface PermissionModeIndicatorProps {
  mode: PermissionMode;
  onToggle?: () => void;  // For future toggle support
}

export function PermissionModeIndicator({ mode, onToggle }: PermissionModeIndicatorProps) {
  const modeConfig = {
    "allow-all": {
      label: "Bypass",
      icon: ShieldOff,
      className: "text-amber-400",
      description: "All permissions bypassed"
    },
    "ask-writes": {
      label: "Ask Writes",
      icon: ShieldAlert,
      className: "text-blue-400",
      description: "Asks for write operations"
    },
    "ask-always": {
      label: "Ask Always",
      icon: Shield,
      className: "text-green-400",
      description: "Asks for all operations"
    },
  };

  const config = modeConfig[mode];
  const Icon = config.icon;

  return (
    <button
      onClick={onToggle}
      disabled={!onToggle}
      className="flex items-center gap-1.5 hover:bg-surface-700 rounded px-1.5 py-0.5 transition-colors disabled:cursor-default"
      title={config.description}
    >
      <Icon className={cn("w-3.5 h-3.5", config.className)} />
      <span className={config.className}>{config.label}</span>
    </button>
  );
}
```

### Phase 5: Token Usage Hook

**File: `src/hooks/use-token-usage.ts` (new)**

```typescript
export function useTokenUsage(threadId: string | null) {
  const [tokens, setTokens] = useState({ inputTokens: 0, outputTokens: 0 });

  useEffect(() => {
    if (!threadId) {
      setTokens({ inputTokens: 0, outputTokens: 0 });
      return;
    }

    // Listen for live token updates during streaming
    const unsubscribe = eventBus.on(EventName.TOKEN_USAGE_UPDATE, (payload) => {
      if (payload.threadId === threadId) {
        setTokens({
          inputTokens: payload.inputTokens,
          outputTokens: payload.outputTokens,
        });
      }
    });

    // Also load from thread metrics if available (for completed threads)
    const thread = useThreadsStore.getState().threads[threadId];
    if (thread?.metrics?.inputTokens !== undefined) {
      setTokens({
        inputTokens: thread.metrics.inputTokens,
        outputTokens: thread.metrics.outputTokens ?? 0,
      });
    }

    return unsubscribe;
  }, [threadId]);

  return tokens;
}
```

### Phase 6: Permission Mode Hook

**File: `src/hooks/use-permission-mode.ts` (new)**

```typescript
export function usePermissionMode(): PermissionMode {
  // For now, return the hardcoded mode
  // Future: This will read from settings/agent state
  return "allow-all";
}

// Future toggle implementation will:
// 1. Store preference in settings
// 2. Pass to agent via runner context
// 3. Update this hook to read from settings store
```

### Phase 7: Integrate Status Bar into Control Panel

**File: `src/components/control-panel/control-panel-window.tsx`**

Add StatusBar below ThreadInput:

```tsx
{/* Input and Status */}
<ThreadInput ... />
<StatusBar threadId={currentThreadId} />

{/* Existing: Suggested Actions, etc. */}
```

### Phase 8: Frontend Event Listener

**File: `src/entities/threads/listeners.ts`**

Add listener for token usage updates to store metrics:

```typescript
eventBus.on(EventName.TOKEN_USAGE_UPDATE, (payload) => {
  // Update thread state with latest token counts
  useThreadsStore.getState().updateThreadMetrics(payload.threadId, {
    inputTokens: payload.inputTokens,
    outputTokens: payload.outputTokens,
  });
});
```

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `core/types/events.ts` | Modify | Add token fields to ResultMetricsSchema, add TOKEN_USAGE_UPDATE event |
| `agents/src/runners/message-handler.ts` | Modify | Extract and emit token usage from SDK messages |
| `src/components/control-panel/status-bar.tsx` | New | Main status bar component |
| `src/components/control-panel/permission-mode-indicator.tsx` | New | Permission mode display with future toggle support |
| `src/hooks/use-token-usage.ts` | New | Hook for reactive token usage |
| `src/hooks/use-permission-mode.ts` | New | Hook for permission mode state |
| `src/components/control-panel/control-panel-window.tsx` | Modify | Add StatusBar to layout |
| `src/entities/threads/listeners.ts` | Modify | Add TOKEN_USAGE_UPDATE listener |
| `src/entities/threads/store.ts` | Modify | Add updateThreadMetrics action |

## Visual Design

```
┌──────────────────────────────────────────────────┐
│  [Message input textarea...]                     │
├──────────────────────────────────────────────────┤
│  🛡️ Bypass                          45.2k / 200k │  ← NEW STATUS BAR
└──────────────────────────────────────────────────┘
```

- Height: ~28px (py-1.5 + text-xs)
- Background: `bg-surface-800` (matches input area)
- Border: `border-t border-surface-700`
- Left side: Permission mode with icon, amber for bypass mode
- Right side: Token count, turns amber when >90% of 200k

## Future Enhancements (Not in Scope)

1. **Permission Mode Toggle** - Click indicator to cycle through modes
2. **Token Usage Breakdown** - Hover to see input vs output tokens
3. **Cost Display** - Show $ cost alongside tokens
4. **Context Warning** - Alert when approaching limit
5. **Per-Turn Tokens** - Show tokens used in current turn

## Testing Considerations

1. **Unit Tests**
   - StatusBar renders with correct layout
   - PermissionModeIndicator shows correct icon/color per mode
   - Token formatting (45.2k, 123.4k, etc.)
   - Warning color at 90% threshold

2. **Integration Tests**
   - Token updates flow from agent → event → hook → UI
   - Metrics persist correctly in thread state
   - Event listener cleanup on unmount

3. **Visual Tests**
   - Status bar positioning below input
   - Responsive text truncation
   - Color contrast accessibility

## Success Criteria

- [ ] Status bar appears below input in control panel
- [ ] Permission mode shows "Bypass" with shield-off icon in amber
- [ ] Token counter shows current usage formatted as "X.Xk / 200k"
- [ ] Token count updates live during agent streaming
- [ ] Token count turns amber when >90% of 200k
- [ ] Final token count persists in thread metrics after completion
- [ ] No performance impact from token tracking
- [ ] TypeScript compiles without errors
- [ ] Existing tests pass
