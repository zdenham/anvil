# Context Meter Feature

Display token usage relative to the context window with detailed breakdown on hover. Each thread (parent and child) tracks its own context independently.

## Phases

- [x] Add TokenUsage to ThreadState and emit from agent
- [x] Create ContextMeter component with tooltip
- [x] Integrate into ThreadHeader (works for both parent and child threads)
- [x] Add tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Overview

The context meter is a visual indicator showing how much of Claude's context window is being used in the current thread. It appears in the **ThreadHeader** for every thread — both parent and child (sub-agent) threads.

**Key design decision:** Parent and child agents run in separate SDK sessions with independent context windows. Each thread tracks its own usage. When clicking into a child agent thread, its header shows *that agent's* context usage, not the parent's.

## Requirements

### Functional
- Display current token usage as a percentage of the context window
- Show visual progress bar that fills based on usage
- On hover, display tooltip with breakdown:
  - Input tokens
  - Output tokens
  - Cache creation tokens
  - Cache read tokens
  - Total tokens / max context
- Update in real-time during agent streaming
- Persist token counts to thread state (already on disk via `state.json`)
- Works identically for parent and child threads — each shows its own context

### Visual
- Compact horizontal bar in thread header (between breadcrumb and action buttons)
- Color-coded by usage level:
  - Green: < 50%
  - Yellow: 50-80%
  - Orange: 80-95%
  - Red: > 95%
- Smooth transitions when values change
- Consistent with existing UI patterns (surface colors, Radix tooltip)

## Architecture

### SDK Token Data Availability

The Anthropic Agent SDK provides per-turn usage on every `SDKAssistantMessage`:

```typescript
// SDKAssistantMessage.message.usage (BetaUsage)
{
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}
```

Final cumulative totals are available on `SDKResultMessage`:

```typescript
// SDKResultMessage.usage (NonNullableUsage) — cumulative for entire run
// SDKResultMessage.modelUsage: Record<string, ModelUsage> — per-model breakdown
// ModelUsage includes contextWindow and maxOutputTokens per model
```

**Important — understanding per-turn token semantics:**

- `input_tokens` on each turn is the **full context sent for that API call** — it includes the entire conversation history. It is NOT incremental. Each turn's `input_tokens` will be larger than the previous as history grows. The latest `input_tokens` is the best real-time indicator of context window pressure.
- `output_tokens` on each turn is only that turn's generated output — it IS incremental.
- `cache_creation_input_tokens` and `cache_read_input_tokens` are per-request caching behavior.
- **Do NOT sum `input_tokens` across turns** — that would massively overcount. Use the latest value as-is.

For sub-agents: messages with a `parent_tool_use_id` are routed to child thread state by `MessageHandler.handleForChildThread()`. We add usage tracking there too.

### Communication: Unix Socket IPC

Agent state reaches the frontend via the **socket IPC architecture** (not stdout):

```
Agent Process                   Unix Socket              Rust AgentHub          Frontend
    │                              │                         │                     │
    │ 1. emitState()               │                         │                     │
    │    - writes state.json       │                         │                     │
    │    - hubClient.sendState()   │                         │                     │
    ├─────────────────────────────>│                         │                     │
    │                              │  2. AgentHub receives   │                     │
    │                              ├────────────────────────>│                     │
    │                              │     Tauri event:        │                     │
    │                              │     "agent:message"     │                     │
    │                              │                         │  3. agent-service.ts│
    │                              │                         │     listen() handler│
    │                              │                         ├────────────────────>│
    │                              │                         │  eventBus.emit(     │
    │                              │                         │    AGENT_STATE)     │
    │                              │                         │                     │
    │                              │                         │  4. Zustand stores  │
    │                              │                         │     subscribe &     │
    │                              │                         │     update UI       │
```

Key files in the IPC chain:
- `agents/src/lib/hub/client.ts` — `HubClient` connects to `~/.anvil/agent-hub.sock`
- `agents/src/output.ts` — `emitState()` writes disk first, then `hubClient.sendState(payload)`
- `src/lib/agent-service.ts` — Tauri `listen<AgentSocketMessage>("agent:message", ...)` routes to eventBus

### Data Flow

```
Parent thread:
  SDKAssistantMessage (parent_tool_use_id = null)
      ↓
  MessageHandler.handleAssistant() extracts usage
      ↓
  updateUsage() sets state.usage
      ↓
  emitState() → disk (state.json) → hubClient.sendState() → socket
      ↓
  Rust AgentHub → Tauri "agent:message" event → agent-service.ts
      ↓
  eventBus.emit(AGENT_STATE, { threadId, state }) → Zustand → ContextMeter

Child thread:
  SDKAssistantMessage (parent_tool_use_id = Task tool ID)
      ↓
  MessageHandler.handleForChildThread() extracts usage into child state
      ↓
  Child state written to child's state.json on disk
      ↓
  When user navigates into child thread, frontend loads child state.json
      ↓
  ContextMeter reads child's usage from loaded state
```

### Why input_tokens is the Right Metric

The context window limit constrains the *input* to each API call. `input_tokens` on the most recent turn tells us how full the context is. Output tokens don't count against the window — they're generated tokens, not stored context. Cache tokens are a billing optimization, not a context pressure indicator.

So the meter should primarily show: **last `input_tokens` / context_window_size**.

The context window size can be obtained from `SDKResultMessage.modelUsage[model].contextWindow` at run completion; default to 200K before that value is available.

The tooltip can show the full breakdown for informational purposes.

## Implementation

### Phase 1: Add TokenUsage to ThreadState and Emit from Agent

#### 1.1 Add TokenUsage to ThreadState schema

**File:** `core/types/events.ts`

Add a `TokenUsage` schema and include it as an optional field on `ThreadStateSchema`:

```typescript
export const TokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// Add to ThreadStateSchema:
usage: TokenUsageSchema.optional(),
```

Also add `contextWindow` and `usage` to `ResultMetricsSchema`:

```typescript
export const ResultMetricsSchema = z.object({
  durationApiMs: z.number(),
  totalCostUsd: z.number(),
  numTurns: z.number(),
  usage: TokenUsageSchema.optional(),
  contextWindow: z.number().optional(), // from SDKResultMessage.modelUsage
});
```

#### 1.2 Emit usage from MessageHandler — parent thread

**File:** `agents/src/runners/message-handler.ts`

In `handleAssistant()`, after marking tool_use blocks as running and before `appendAssistantMessage()`, extract usage:

```typescript
private async handleAssistant(msg: SDKAssistantMessage): Promise<boolean> {
  // ... existing: iterate content blocks, markToolRunning() ...

  // Extract and store per-turn usage
  if (msg.message.usage) {
    await updateUsage({
      inputTokens: msg.message.usage.input_tokens,
      outputTokens: msg.message.usage.output_tokens,
      cacheCreationTokens: msg.message.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: msg.message.usage.cache_read_input_tokens ?? 0,
    });
  }

  await appendAssistantMessage({ ... });
  return true;
}
```

Note: `updateUsage` imported from `../output.js` (top-level import, not dynamic).

#### 1.3 Emit usage from MessageHandler — child thread

In `handleForChildThread()`, case `"assistant"`, extract usage into the child's in-memory state (which is later written to disk):

```typescript
case "assistant": {
  const msg = message as SDKAssistantMessage;

  // Extract usage for child thread
  if (msg.message.usage) {
    childState.usage = {
      inputTokens: msg.message.usage.input_tokens,
      outputTokens: msg.message.usage.output_tokens,
      cacheCreationTokens: msg.message.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: msg.message.usage.cache_read_input_tokens ?? 0,
    };
  }

  // ... existing: mark tool_use blocks, push message, write to disk ...
}
```

Child state is managed via `this.childThreadStates: Map<string, ThreadState>` and written to disk at the end of `handleForChildThread()`. The usage field will be persisted automatically.

#### 1.4 Add updateUsage to output.ts

**File:** `agents/src/output.ts`

Follow the existing pattern of direct state mutation + emitState():

```typescript
export async function updateUsage(usage: TokenUsage): Promise<void> {
  state.usage = usage;
  await emitState();
}
```

This writes the updated state to disk and sends it over the socket to the frontend.

#### 1.5 Include usage and contextWindow in complete() metrics

In `handleResult()`, extract `contextWindow` from `SDKResultMessage.modelUsage` and pass through to `complete()`:

```typescript
// Extract context window size from modelUsage (use first model's value)
const modelUsageEntries = Object.values(msg.modelUsage ?? {});
const contextWindow = modelUsageEntries[0]?.contextWindow;

await complete({
  durationApiMs: msg.duration_api_ms,
  totalCostUsd: msg.total_cost_usd,
  numTurns: msg.num_turns,
  usage: state.usage,
  contextWindow,
});
```

### Phase 2: Create ContextMeter Component

#### 2.1 Create the component

**File:** `src/components/content-pane/context-meter.tsx`

A compact bar + percentage that reads usage from the thread's state. On hover, shows a Radix tooltip with full breakdown.

```typescript
const DEFAULT_CONTEXT_WINDOW = 200_000;

const USAGE_LEVELS = [
  { max: 0.5, color: "bg-green-500", label: "low" },
  { max: 0.8, color: "bg-yellow-500", label: "medium" },
  { max: 0.95, color: "bg-orange-500", label: "high" },
  { max: Infinity, color: "bg-red-500", label: "critical" },
] as const;
```

Props: `{ threadId: string }`

The component:
1. Reads usage from thread state (via the thread store's state selector)
2. Uses `contextWindow` from metrics if available, otherwise `DEFAULT_CONTEXT_WINDOW`
3. Computes `percentage = inputTokens / contextWindow`
4. Renders a bar with color based on threshold
5. Wraps in Radix Tooltip showing the full breakdown

#### 2.2 Read usage from thread state

The frontend receives `ThreadState` via socket IPC events (`AGENT_STATE`) and stores it in Zustand. The `usage` field added in Phase 1 flows through automatically — no new store or event handling needed.

For child threads: when the user navigates into a child thread, the frontend loads the child's `state.json` from disk. The `usage` field is included in the persisted state.

### Phase 3: Integrate into ThreadHeader

**File:** `src/components/content-pane/content-pane-header.tsx`

Add `<ContextMeter threadId={threadId} />` to the `ThreadHeader` component, positioned between the breadcrumb and the action buttons (in the `ml-auto` div, before the cancel button).

This works for both parent and child threads because `ThreadHeader` always receives the active `threadId`. When viewing a child thread, the threadId is the child's ID, so the meter shows the child's context usage.

```
┌─────────────────────────────────────────────────────────────┐
│ ● repo / worktree / thread    [═══░░░] 15%  [Cancel] [×]   │
└─────────────────────────────────────────────────────────────┘

Tooltip on hover:
┌──────────────────────────┐
│ Context Window            │
│ ─────────────────────     │
│ Input:       30,290       │
│ Output:       8,234       │
│ Cache write:  2,100       │
│ Cache read:   7,500       │
│ ─────────────────────     │
│ 30,290 / 200,000 (15.1%)  │
└──────────────────────────┘
```

### Phase 4: Tests

- Unit test for percentage calculation and threshold logic
- Component test for ContextMeter rendering with various usage levels
- Verify tooltip content renders correct breakdown

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `core/types/events.ts` | Modify | Add `TokenUsageSchema`, add `usage` to `ThreadStateSchema` and `ResultMetricsSchema`, add `contextWindow` to `ResultMetricsSchema` |
| `agents/src/runners/message-handler.ts` | Modify | Extract usage in `handleAssistant()` and `handleForChildThread()`, extract `contextWindow` from `modelUsage` in `handleResult()` |
| `agents/src/output.ts` | Modify | Add `updateUsage()` function |
| `src/components/content-pane/context-meter.tsx` | Create | ContextMeter component with bar + tooltip |
| `src/components/content-pane/content-pane-header.tsx` | Modify | Add ContextMeter to ThreadHeader |

## Edge Cases

- **No token data yet**: Don't render the meter (return null)
- **Exceeds context**: Cap bar at 100%, show red
- **Child thread with no usage**: Same as parent — don't render until first usage arrives
- **Thread switching**: React key on threadId ensures clean remount
- **Resume**: Usage persists in state.json, so resumed threads show their last known usage immediately
- **Context window size unknown**: Default to 200K until `SDKResultMessage.modelUsage` provides the actual value
