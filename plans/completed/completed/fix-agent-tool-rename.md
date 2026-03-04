# Fix Agent Tool Rename (SDK 0.2.64: Task → Agent)

## Problem

The Claude Agent SDK v0.2.64 renamed the sub-agent spawning tool from `Task` to `Agent`. This breaks two critical systems:

### 1. Agent runner hooks don't fire → child threads never created
- `agents/src/runners/shared.ts:711` — `matcher: "Task"` never matches `"Agent"` tool calls
- `agents/src/runners/shared.ts:979` — `if (input.tool_name === "Task")` in PostToolUse never fires
- **Result**: No child thread metadata is created on disk, no `THREAD_CREATED` event emitted, no sub-agent tracking

### 2. Frontend tool block registry missing "agent" → legacy fallback renders
- `src/components/thread/tool-blocks/index.ts:65` — maps `task` but not `agent`
- `getSpecializedToolBlock("Agent")` returns `null`
- Falls through to generic `ToolUseBlock` (`src/components/thread/tool-use-block.tsx`) which renders the old `<details>` element with legacy styling:
  ```
  flex items-center gap-2 p-3 cursor-pointer select-none list-none
  [&::-webkit-details-marker]:hidden hover:bg-zinc-800/50 rounded-lg transition-colors
  ```

### Evidence
Thread `eaed597f-aa23-4e9c-89b0-fbcfe53c3bf3` shows a `tool_use` block with `name: "Agent"` (not `"Task"`). The `TaskToolBlock` never receives it, so `SubAgentReferenceBlock` never renders.

## Phases

- [x] Fix agent runner hooks to match both "Task" and "Agent"
- [x] Update frontend tool block registry and utility mappings
- [x] Replace legacy ToolUseBlock with new flashing style
- [x] Verify all touch points handle both names

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix agent runner hooks

**File**: `agents/src/runners/shared.ts`

### PreToolUse hook (line 711)
Change the matcher to match both names:
```ts
// Before
{ matcher: "Task", hooks: [...] }

// After — accept both old and new SDK tool name
{ matcher: /^(Task|Agent)$/, hooks: [...] }
```
> **Note**: Verify that the SDK's hook matcher accepts RegExp. If not, register two separate hooks or use a function matcher.

### PostToolUse handler (line 979)
```ts
// Before
if (input.tool_name === "Task") {

// After
if (input.tool_name === "Task" || input.tool_name === "Agent") {
```

### Log messages
Update all `[PreToolUse:Task]` and `[PostToolUse:Task]` log prefixes to be name-aware (e.g., `[PreToolUse:Agent]`), or use a generic prefix like `[PreToolUse:SubAgent]`.

## Phase 2: Update frontend tool block registry and utilities

### Tool block registry
**File**: `src/components/thread/tool-blocks/index.ts`

Add `agent` mapping alongside `task`:
```ts
const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  // ... existing ...
  task: TaskToolBlock,
  agent: TaskToolBlock,  // SDK 0.2.64 renamed Task → Agent
  // ...
};
```

### Tool formatter
**File**: `src/lib/utils/tool-formatters.ts:88`

```ts
// Before
if (name === "task") {

// After
if (name === "task" || name === "agent") {
```

### Tool icons
**File**: `src/lib/utils/tool-icons.ts:31`

```ts
// Before
{ pattern: /^(Task)/i, config: { icon: "git-branch", description: "Subagent" } }

// After
{ pattern: /^(Task|Agent)/i, config: { icon: "git-branch", description: "Subagent" } }
```

### Generic ToolUseBlock icon map
**File**: `src/components/thread/tool-use-block.tsx:57`

Add `agent: GitBranch` to the `TOOL_ICONS` map.

## Phase 3: Replace legacy ToolUseBlock with new flashing style

The user wants to eliminate the legacy `<details>` based tool block rendering entirely. Currently `ToolUseBlock` (`src/components/thread/tool-use-block.tsx`) renders a `<details>` element with:
- Bordered card with chevrons
- Old-style expand/collapse
- No shimmer/flashing for running state

Replace with the same visual language as specialized blocks:
- Remove the `<details>/<summary>` structure
- Use `ShimmerText` for running state (consistent with `TaskToolBlock`, `BashToolBlock`, etc.)
- Use `ExpandChevron` component for expand/collapse
- Use `CollapsibleOutputBlock` for result content
- Keep the permission approval inline UI (it's still needed for unrecognized tools)

The new generic block should follow the two-line layout pattern:
- Line 1: Tool display name (with shimmer when running) + duration/status
- Line 2: Icon + formatted input summary
- Expandable: input JSON + output

## Phase 4: Verify all touch points

Affected files that reference "Task" tool name:

| File | Line(s) | What to check |
|------|---------|---------------|
| `agents/src/runners/shared.ts` | 711, 979, 1242-1247 | Hook matchers and PostToolUse check |
| `src/components/thread/tool-blocks/index.ts` | 65 | Registry mapping |
| `src/components/thread/tool-blocks/task-tool-block.tsx` | 100 | Component name (cosmetic, ok as-is) |
| `src/components/thread/tool-blocks/sub-agent-reference-block.tsx` | 66 | Display text says "Task agent" → update to "Sub-agent" or "Agent" |
| `src/components/thread/tool-use-block.tsx` | 57 | TOOL_ICONS map |
| `src/lib/utils/tool-formatters.ts` | 88 | Name check |
| `src/lib/utils/tool-icons.ts` | 31 | Pattern match |
| `src/hooks/use-tree-data.ts` | — | Uses `parentThreadId`/`agentType`, no tool name dep (OK) |
| `src/hooks/use-child-thread-tool-count.ts` | — | Uses `tool_use` block type, no tool name dep (OK) |
| `src/entities/threads/store.ts` | 104-105 | Uses `parentToolUseId`, no tool name dep (OK) |
| `agents/src/runners/shared.ts` | 1242-1247 | Manager agent description mentions "Task tool" → update text |

### Display text updates
In `task-tool-block.tsx` and `sub-agent-reference-block.tsx`, the UI shows "Task agent" / "Running task agent". Update to "Sub-agent" / "Running sub-agent" since the underlying tool is now "Agent".

## Risk Assessment

- **Backwards compatibility**: Old thread state files on disk still have `name: "Task"` tool_use blocks. The `task` registry entry must remain alongside `agent` so historical threads render correctly.
- **SDK version drift**: If another user has an older SDK, they'll still emit `"Task"`. Both names must be supported simultaneously.
- **Hook matcher format**: Need to verify the SDK accepts regex or string array matchers. If only string, register two separate hooks.
