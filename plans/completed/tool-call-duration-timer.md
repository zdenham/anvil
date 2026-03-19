# Tool Call Duration Timer

Show a live elapsed-time timer on Bash and Sub-agent tool blocks that ticks every second while running and persists the final duration once complete.

## Context

`ToolExecutionState` currently tracks only `status`, `result`, `isError`, and `toolName`. There is no timing information. The UI can't show how long a tool call took or has been running.

## Design

**Backend (agent):** Add `startedAt` and `completedAt` (epoch ms) to `ToolExecutionState`. Set `startedAt` in `MARK_TOOL_RUNNING`, `completedAt` in `MARK_TOOL_COMPLETE` and `markOrphanedTools`. These persist to `state.json` and flow over the socket via `thread_action`, so hydration/reconnect preserve them.

**Frontend (React):** A `useToolDuration` hook reads `startedAt`/`completedAt` from tool state. While running, a `setInterval(1000)` ticks a local counter so the display updates every second with zero socket traffic. On completion, it returns the static final duration. Returns a formatted string like `"3s"`, `"1m 23s"`.

**Render locations:** Right-aligned on line 1 of `BashToolBlock`, `SubAgentReferenceBlock`, and `TaskToolBlock` (no-child-thread fallback). Styled as `text-xs text-zinc-500 font-mono tabular-nums` so digits don't shift as they change width.

## Key files

| File | Change |
| --- | --- |
| `core/types/events.ts` | Add `startedAt`, `completedAt` to `ToolExecutionStateSchema` |
| `core/lib/thread-reducer.ts` | Set timestamps in `MARK_TOOL_RUNNING`, `applyMarkToolComplete`, `markOrphanedTools` |
| `src/hooks/use-tool-duration.ts` | New hook: reads timing from `useToolState`, ticks via `setInterval` while running |
| `src/components/thread/tool-blocks/bash-tool-block.tsx` | Render duration on line 1 right side |
| `src/components/thread/tool-blocks/sub-agent-reference-block.tsx` | Render duration on line 1 right side (next to tool count) |
| `src/components/thread/tool-blocks/task-tool-block.tsx` | Render duration on line 1 right side (no-child-thread fallback) |

## Phases

- [x] Add timing fields to `ToolExecutionState` and reducer

- [x] Create `useToolDuration` hook

- [x] Render timer in Bash and Sub-agent tool blocks

- [x] Verify with existing tests / add unit test for hook

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add timing fields to `ToolExecutionState` and reducer

`core/types/events.ts` — extend schema:

```ts
export const ToolExecutionStateSchema = z.object({
  status: z.enum(["running", "complete", "error"]),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  toolName: z.string().optional(),
  startedAt: z.number().optional(),   // epoch ms — set on MARK_TOOL_RUNNING
  completedAt: z.number().optional(), // epoch ms — set on MARK_TOOL_COMPLETE
});
```

`core/lib/thread-reducer.ts` — set timestamps:

In `MARK_TOOL_RUNNING` case:

```ts
[action.payload.toolUseId]: {
  status: "running",
  toolName: action.payload.toolName,
  startedAt: Date.now(),
},
```

In `applyMarkToolComplete`:

```ts
{
  status: payload.isError ? "error" : "complete",
  result: payload.result,
  isError: payload.isError,
  toolName: existing?.toolName,
  startedAt: existing?.startedAt,       // preserve
  completedAt: Date.now(),
}
```

In `markOrphanedTools` (for interrupted tools):

```ts
result[id] = {
  status: "error",
  result: "Tool execution was interrupted",
  isError: true,
  startedAt: tool.startedAt,            // preserve
  completedAt: Date.now(),
};
```

Note: `Date.now()` in the reducer is impure but acceptable — these are observation timestamps, not deterministic logic. The same pattern is already used for `state.timestamp` in `writeToDisk()`.

## Phase 2: Create `useToolDuration` hook

New file `src/hooks/use-tool-duration.ts`:

```ts
import { useState, useEffect } from "react";
import { useToolState } from "./use-tool-state";

/** Format milliseconds as a compact duration string. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Returns a live-updating duration string for a tool call.
 * Ticks every second while running, returns static value when complete.
 * Returns null if no startedAt is available (legacy tool states).
 */
export function useToolDuration(
  threadId: string,
  toolUseId: string,
): string | null {
  const { status, startedAt, completedAt } = useToolState(threadId, toolUseId);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== "running" || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  if (!startedAt) return null;

  if (status === "running") {
    return formatDuration(now - startedAt);
  }

  // Complete or error — use persisted completedAt, fall back to now
  const end = completedAt ?? Date.now();
  return formatDuration(end - startedAt);
}
```

Key decisions:

- Returns `null` for legacy tool states (no `startedAt`) so callers can conditionally render
- `setInterval` fires only while `status === "running"` — automatically stops on completion
- `tabular-nums` font variant on the display element prevents layout shift as digits change

## Phase 3: Render timer in Bash and Sub-agent tool blocks

`BashToolBlock` — add to line 1, right-aligned before the `(bg: ...)` tag:

```tsx
import { useToolDuration } from "@/hooks/use-tool-duration";
// ...
const duration = useToolDuration(threadId, id);
// ...
{/* Right side of line 1 */}
<span className="flex items-center gap-2 shrink-0 ml-auto">
  {duration && (
    <span className="text-xs text-zinc-500 font-mono tabular-nums">
      {duration}
    </span>
  )}
  {isBackground && (
    <span className="text-xs text-zinc-500 font-mono">
      (bg: {id.slice(0, 8)})
    </span>
  )}
</span>
```

`SubAgentReferenceBlock` — add to line 1, before Open button:

```tsx
// Accept startedAt/completedAt as props or use the hook via threadId
// Since SubAgentReferenceBlock doesn't currently have threadId,
// we'll need to thread it through from TaskToolBlock.

// In TaskToolBlock, pass parentThreadId:
<SubAgentReferenceBlock
  toolUseId={id}
  childThreadId={childThread.id}
  name={childThread.name ?? "Sub-agent"}
  status={childThread.status}
  toolCallCount={toolCallCount}
  threadId={threadId}  // NEW — parent thread where the tool_use lives
/>

// In SubAgentReferenceBlock:
import { useToolDuration } from "@/hooks/use-tool-duration";
// ...
const duration = useToolDuration(threadId, toolUseId);
// ...
{duration && (
  <span className="text-xs text-zinc-500 font-mono tabular-nums">
    {duration}
  </span>
)}
```

`TaskToolBlock` (no-child-thread fallback) — same pattern as BashToolBlock, add duration to line 1 right side.

## Phase 4: Tests

- Unit test for `formatDuration` (0s, 59s, 1m 0s, 5m 23s edge cases)
- Unit test for `useToolDuration` with fake timers (vitest `vi.useFakeTimers`)
  - Verify it returns null when no `startedAt`
  - Verify it ticks while running
  - Verify it returns static value when complete
- Verify existing thread-reducer tests still pass (the new optional fields shouldn't break anything)