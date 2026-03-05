# Phase 3: Refactor Tool Blocks to Select Their Own State

## Current problem

Tool blocks receive `result`, `isError`, `status` as **props**, computed by `AssistantMessage` during its render:

```tsx
// In AssistantMessage (current) — line 84
const state = toolStates?.[block.id] ?? { status: "running" as const };
<SpecializedBlock result={state.result} isError={state.isError} status={state.status} ... />
```

This means any tool state change triggers AssistantMessage's render, which recomputes ALL tool blocks' states and passes new prop objects to ALL of them — even the ones that didn't change.

## Store architecture (verified)

```
useThreadStore.threadStates[threadId].toolStates[toolUseId]
```

- Store: `useThreadStore` from `@/entities/threads/store`
- Shape: `ThreadStoreState.threadStates: Record<string, ThreadRenderState>`
- `ThreadRenderState` = `ThreadState` (alias in `@/lib/thread-state-machine.ts` line 32)
- `ThreadState.toolStates: Record<string, ToolExecutionState>` (from `core/types/events.ts` line 433)
- `ToolExecutionState`: `{ status: "running" | "complete" | "error", result?: string, isError?: boolean, toolName?: string }`
- `ToolStatus` (from `tool-status-icon.tsx`): `"running" | "complete" | "error" | "pending"`

Note: `ToolExecutionState.status` uses `"running" | "complete" | "error"` (3 values). `ToolStatus` has an extra `"pending"` value. The default `{ status: "running" }` is correct for missing entries.

## New pattern: tool blocks select their own state

### useToolState hook

```ts
// src/hooks/use-tool-state.ts
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useThreadStore } from "@/entities/threads/store";
import type { ToolExecutionState } from "@/lib/types/agent-messages";

const DEFAULT_STATE: ToolExecutionState = { status: "running" };

export function useToolState(threadId: string, toolUseId: string): ToolExecutionState {
  return useThreadStore(
    useShallow(
      useCallback(
        (s) => s.threadStates[threadId]?.toolStates?.[toolUseId] ?? DEFAULT_STATE,
        [threadId, toolUseId]
      )
    )
  );
}
```

`useShallow` ensures the component only re-renders when this specific tool's `status`, `result`, or `isError` values actually change — not when a sibling tool's state updates.

### ToolBlockProps interface (after)

```ts
// tool-blocks/index.ts
export interface ToolBlockProps {
  /** Unique tool use ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Thread ID for store selectors and expand state */
  threadId: string;
}
```

Removed: `result`, `isError`, `status`, `durationMs`, `isFocused`.

**durationMs**: Not currently passed by `AssistantMessage` — already unused. The `ToolBlockProps` interface declares it but `AssistantMessage` never sets it. Tool blocks reference it from destructured props but it's always `undefined`. **Remove from interface; delete from destructuring in all blocks.**

**isFocused**: Same situation — declared in `ToolBlockProps` but never passed by `AssistantMessage`. **Remove from interface; delete from destructuring in all blocks.**

### Specialized tool blocks

Each block calls `useToolState(threadId, id)` internally and destructures what it needs:

```tsx
// Example: BashToolBlock (after)
export function BashToolBlock({ id, name, input, threadId }: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);
  // ... rest unchanged
}
```

### Generic ToolUseBlock

`ToolUseBlock` has its own `ToolUseBlockProps` interface (separate from `ToolBlockProps`). Apply the same change:

```tsx
interface ToolUseBlockProps {
  id: string;
  name: string;
  input: Record<string, unknown>;
  onOpenDiff?: (filePath: string) => void;
  threadId: string;
}

export function ToolUseBlock({ id, name, input, onOpenDiff, threadId }: ToolUseBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);
  // ... rest unchanged
}
```

Note: `durationMs` can also be removed from `ToolUseBlockProps` — it is declared but never passed by `AssistantMessage`.

## Files to update

### New file

| File | Change |
|---|---|
| `src/hooks/use-tool-state.ts` | **New hook** — `useToolState(threadId, toolUseId)` selector |

### Core files

| File | Change |
|---|---|
| `src/components/thread/tool-blocks/index.ts` | Remove `result`, `isError`, `status`, `durationMs`, `isFocused` from `ToolBlockProps` |
| `src/components/thread/tool-use-block.tsx` | Remove `result`, `isError`, `status`, `durationMs` from `ToolUseBlockProps`; add `useToolState` call |
| `src/components/thread/assistant-message.tsx` | Stop computing `toolStates?.[block.id]`; stop passing `result`/`isError`/`status` as props to `SpecializedBlock` and `ToolUseBlock` |
| `src/components/thread/live-ask-user-question.tsx` | Replace `toolState` prop with `useToolState` hook; update fallback `ToolUseBlock` calls |

### All 18 specialized tool block files

Each one: remove `result`, `isError`, `status`, `durationMs`, `isFocused` from destructured props; add `const { status, result, isError } = useToolState(threadId, id)`.

| File | Component | Notes |
|---|---|---|
| `tool-blocks/bash-tool-block.tsx` | `BashToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/edit-tool-block.tsx` | `EditToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/write-tool-block.tsx` | `WriteToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/read-tool-block.tsx` | `ReadToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/glob-tool-block.tsx` | `GlobToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/grep-tool-block.tsx` | `GrepToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/task-tool-block.tsx` | `TaskToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/skill-tool-block.tsx` | `SkillToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/web-search-tool-block.tsx` | `WebSearchToolBlock` | Uses `result`, `isError`, `status` (see server_tool_use note below) |
| `tool-blocks/web-fetch-tool-block.tsx` | `WebFetchToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/lsp-tool-block.tsx` | `LSPToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/notebook-edit-tool-block.tsx` | `NotebookEditToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/todowrite-tool-block.tsx` | `TodoWriteToolBlock` | Uses `status` only (no `result`/`isError` in render body) |
| `tool-blocks/enterplanmode-tool-block.tsx` | `EnterPlanModeToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/exitplanmode-tool-block.tsx` | `ExitPlanModeToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/killshell-tool-block.tsx` | `KillShellToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/taskoutput-tool-block.tsx` | `TaskOutputToolBlock` | Uses `result`, `isError`, `status` |
| `tool-blocks/taskstop-tool-block.tsx` | `TaskStopToolBlock` | Uses `result`, `isError`, `status` |

**Not in scope** (does not use `ToolBlockProps`):
- `tool-blocks/sub-agent-reference-block.tsx` — has its own props interface, rendered by `TaskToolBlock` internally

## server_tool_use special case

`server_tool_use` blocks (web search via Anthropic's server-side tool) get their result from a **sibling content block** (`web_search_tool_result`), not from `toolStates`. Today `AssistantMessage` finds the sibling block and passes `result`/`status`/`isError` as props.

After this refactoring, `AssistantMessage` still needs to handle `server_tool_use` specially. Two options:

**Option A (recommended): Keep server_tool_use passing result as props.**
`WebSearchToolBlock` gets a split interface: when rendered for a `server_tool_use`, the parent passes `result`/`status`/`isError` explicitly. When rendered for a client-side `tool_use`, it calls `useToolState`. The simplest way: have `WebSearchToolBlock` check if `result` is passed as a prop and skip the hook if so, or use a separate wrapper. Since server_tool_use is rare and the result shape differs, keeping the prop pass-through for this case is cleanest.

**Option B: WebSearchToolBlock always calls useToolState, and server_tool_use results get injected into toolStates by AssistantMessage.** More uniform but adds complexity for a rare case.

**Decision: Option A.** `WebSearchToolBlock` keeps optional `result`/`isError`/`status` props for the server_tool_use path. When they are `undefined`, it falls back to `useToolState(threadId, id)`. This means its props interface extends `ToolBlockProps` with optional overrides:

```tsx
interface WebSearchToolBlockProps extends ToolBlockProps {
  /** Override from server_tool_use sibling block (not from toolStates) */
  serverResult?: string;
  serverIsError?: boolean;
  serverStatus?: "running" | "complete";
}
```

## ToolPermissionWrapper

Currently receives `toolInput` as a prop from `AssistantMessage`. This stays unchanged — it comes directly from the content block (stable reference) and is used for display purposes (diff generation). `ToolPermissionWrapper` does not use `result`/`isError`/`status`.

## LiveAskUserQuestion

Currently receives `toolState: ToolExecutionState` as a prop. After refactoring:

```tsx
export function LiveAskUserQuestion({
  blockId,
  blockInput,
  threadId,
  onToolResponse,
}: LiveAskUserQuestionProps) {
  const toolState = useToolState(threadId, blockId);
  // ... rest unchanged — uses toolState.result, toolState.isError, toolState.status
}
```

The fallback `ToolUseBlock` calls inside `LiveAskUserQuestion` (lines 83-92, 134-144) also drop the `result`/`isError`/`status` props since `ToolUseBlock` will select its own state.

The component already uses `useQuestionStore` for its interactive state — this change just moves the tool execution state source from prop to hook.

## AssistantMessage changes

After migration, the `tool_use` case simplifies to:

```tsx
case "tool_use": {
  if (block.name === "AskUserQuestion") {
    return (
      <LiveAskUserQuestion
        key={block.id}
        blockId={block.id}
        blockInput={block.input}
        threadId={threadId}
        onToolResponse={onToolResponse}
      />
    );
  }

  const SpecializedBlock = getSpecializedToolBlock(block.name);
  if (SpecializedBlock) {
    return (
      <ToolPermissionWrapper
        key={block.id}
        toolUseId={block.id}
        toolName={block.name}
        toolInput={block.input as Record<string, unknown>}
        threadId={threadId}
      >
        <SpecializedBlock
          id={block.id}
          name={block.name}
          input={block.input as Record<string, unknown>}
          threadId={threadId}
        />
      </ToolPermissionWrapper>
    );
  }

  return (
    <ToolUseBlock
      key={block.id}
      id={block.id}
      name={block.name}
      input={block.input as Record<string, unknown>}
      threadId={threadId}
    />
  );
}
```

The `toolStates?.[block.id]` lookup on line 84 is removed entirely. The `toolStates` prop on `AssistantMessageProps` can be removed (or kept temporarily for the `server_tool_use` path).

The `server_tool_use` case passes server-derived result to `WebSearchToolBlock` via the dedicated override props.

## Migration safety

Since this is a mechanical change (move data source from prop to hook), we can do it incrementally:

1. Create the `useToolState` hook in `src/hooks/use-tool-state.ts`
2. Update one tool block at a time — add `useToolState` call, remove state props from destructuring
3. Verify each renders correctly before moving to the next
4. After all 18 specialized blocks + generic `ToolUseBlock` + `LiveAskUserQuestion` are migrated, update `ToolBlockProps` interface to remove `result`/`isError`/`status`/`durationMs`/`isFocused`
5. Update `AssistantMessage` to stop computing and passing tool state
6. Remove `toolStates` from `AssistantMessageProps` (keep only if needed for server_tool_use)

## Verification

- Each tool block should render identically before and after
- Running tools should show shimmer + "running" status
- Completed tools should show result text
- Error tools should show red error styling
- Permission-pending tools should show approval UI (via `ToolPermissionWrapper`)
- server_tool_use web search blocks should still show results from sibling content blocks
- `LiveAskUserQuestion` should still show interactive question UI for pending questions and historical answers for completed ones
