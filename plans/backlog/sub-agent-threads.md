# Sub-Agent Thread Display Plan

## Overview

When the main agent spawns sub-agents via the Claude Code SDK's `Task` tool, we want to:
1. Display sub-agent conversations as indented/collapsed sections (like Claude Code does for parallel tool calls)
2. Potentially store sub-agent conversations separately so they can be viewed as independent threads

Currently, all tool calls are fed to the main chat panel, which gets noisy when sub-agents perform many operations.

---

## Research Phase: Understanding the Task Tool

### Key Question: What data does the Task tool return?

Before implementing, we need to understand what the Claude Code SDK provides when a Task tool completes:

**Investigation needed:**
1. What does the `tool_result` contain for a Task tool call?
   - Full sub-agent conversation history?
   - Just a summary of what was accomplished?
   - References to files/outputs?

2. Does the SDK emit events during sub-agent execution?
   - Can we hook into sub-agent tool calls in real-time?
   - Or do we only get results after the sub-agent completes?

3. How does Claude Code (the CLI) render Task tool results?
   - Does it show the full conversation?
   - Does it collapse/indent the output?

**Files to investigate:**
- Claude Code SDK source (if available)
- `agents/src/runners/shared.ts` - PostToolUse hooks
- `agents/src/output.ts` - how tool results are captured

---

## Option A: Enhanced Tool Display (Minimal Storage Changes)

**Approach:** Keep sub-agent output in the parent thread, but render it specially.

### How it works

1. **Detection**: Identify when a `tool_use` block has `name === "task"` or `name === "Task"`
2. **Parsing**: Parse the tool result to extract:
   - Sub-agent description
   - Tool calls made by sub-agent
   - Final output/summary
3. **Rendering**: Create `SubAgentBlock` component that:
   - Shows as collapsed by default
   - Displays sub-agent description in header
   - Expands to show nested tool calls with indentation

### Pros
- No storage schema changes
- Works with existing thread state
- Backwards compatible

### Cons
- Can't view sub-agent as independent thread
- All data still in parent thread (can't navigate to sub-agent directly)
- If SDK only provides summary, can't show full conversation

### Implementation Sketch

```
src/components/thread/
  sub-agent-block.tsx        # New component for Task tool display
  tool-use-block.tsx         # Update to route to SubAgentBlock for task tools
```

```typescript
// sub-agent-block.tsx
interface SubAgentBlockProps {
  id: string;
  description: string;
  toolCalls: ParsedToolCall[];  // Extracted from tool_result
  summary: string;
  status: "running" | "complete" | "error";
  durationMs?: number;
}

export function SubAgentBlock({ ... }: SubAgentBlockProps) {
  return (
    <details className="ml-6 border-l-2 border-secondary-500/30 pl-4">
      <summary>
        <GitBranch /> Sub-agent: {description}
      </summary>
      <div className="space-y-2">
        {toolCalls.map(call => (
          <ToolUseBlock key={call.id} {...call} />
        ))}
        <div className="text-sm text-muted-foreground">{summary}</div>
      </div>
    </details>
  );
}
```

---

## Option B: First-Class Sub-Agent Threads (Schema Changes)

**Approach:** Store sub-agent conversations as separate threads with parent-child relationship.

### How it works

1. **Thread Hierarchy**: Add `parentThreadId` to thread metadata
2. **Storage**: Sub-agent threads stored at:
   ```
   ~/.anvil/tasks/{slug}/threads/
     execution-{parentId}/           # Parent thread
     subagent-{childId}/             # Child thread (new)
       metadata.json                 # Has parentThreadId field
       state.json
   ```
3. **Event Flow**: When sub-agent spawns:
   - Create child thread on disk
   - Emit `thread:created` event with `parentThreadId`
   - Update parent's tool_use state with `childThreadId`
4. **UI Navigation**:
   - Show sub-agent as indented block in parent
   - Click to navigate to sub-agent's full thread view

### Pros
- Sub-agents are first-class citizens
- Can view full conversation history
- Can track metrics per sub-agent
- Matches mental model of "nested tasks"

### Cons
- Schema changes required
- More complex event flow
- Need to handle sub-agent lifecycle (cleanup, orphans)

### Data Model Changes

```typescript
// core/types/threads.ts
interface ThreadMetadata {
  // ... existing fields
  parentThreadId?: string;        // NEW: Reference to parent thread
  childThreadIds?: string[];      // NEW: List of sub-agent threads (denormalized)
}

// New type for sub-agent context
interface SubAgentContext {
  toolUseId: string;              // ID of the Task tool_use that spawned this
  description: string;            // Description passed to Task tool
  parentThreadId: string;
}
```

### Event Changes

```typescript
// New event for sub-agent creation
interface SubAgentCreatedEvent {
  parentThreadId: string;
  childThreadId: string;
  toolUseId: string;              // Links back to the tool_use block
  description: string;
}
```

### UI Changes

```
src/components/thread/
  sub-agent-block.tsx            # Renders sub-agent with navigation

src/entities/threads/
  service.ts                     # Add getChildThreads(), getParentThread()
  listeners.ts                   # Handle subagent:created event
```

---

## Option C: Hybrid Approach (Recommended)

**Approach:** Start with enhanced display (Option A), then add first-class storage (Option B) incrementally.

### Phase 1: Enhanced Display
- Parse Task tool results
- Create `SubAgentBlock` component
- Display sub-agent tool calls as nested/indented
- No storage changes

### Phase 2: SDK Investigation
- Determine what data is actually available from Task tool
- Check if we can hook into sub-agent execution for real-time updates
- Document findings

### Phase 3: First-Class Threads (if needed)
- Only if Phase 2 reveals we can capture full sub-agent state
- Add `parentThreadId` to schema
- Implement navigation between parent/child threads

---

## Phase 1 Implementation Plan

### Step 1.1: Investigate Task Tool Output

**Goal:** Understand what data the Task tool returns.

**Actions:**
1. Run an agent that uses the Task tool
2. Capture the full `tool_result` content
3. Document the structure

**Expected result structure (hypothesis):**
```typescript
// Task tool_result might contain:
{
  type: "task_result",
  description: "Search for authentication code",
  agentId: "abc123",
  output: "Found 3 files related to authentication...",
  // Possibly nested tool calls?
  toolCalls?: [...],
  // Possibly duration/metrics?
  durationMs?: number,
}
```

### Step 1.2: Parse Task Tool Results

**File:** `src/lib/utils/task-tool-parser.ts` (new, ~50 lines)

```typescript
interface ParsedTaskResult {
  description: string;
  summary: string;
  toolCalls: ParsedToolCall[];
  durationMs?: number;
  error?: string;
}

interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

/**
 * Parse the tool_result from a Task tool call.
 * Returns structured data for rendering.
 */
export function parseTaskToolResult(result: string): ParsedTaskResult {
  // Implementation depends on Step 1.1 findings
  // For now, treat as plain text summary
  return {
    description: "Sub-agent task",
    summary: result,
    toolCalls: [],
  };
}
```

### Step 1.3: Create SubAgentBlock Component

**File:** `src/components/thread/sub-agent-block.tsx` (~100 lines)

```typescript
import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch, Loader2, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolUseBlock } from "./tool-use-block";
import type { ParsedTaskResult, ParsedToolCall } from "@/lib/utils/task-tool-parser";

interface SubAgentBlockProps {
  id: string;
  name: string;
  input: { description?: string; prompt?: string };
  result?: ParsedTaskResult;
  status: "running" | "complete" | "error";
  durationMs?: number;
}

/**
 * Renders a Task tool call as a collapsible sub-agent block.
 * Shows nested tool calls with indentation.
 */
export function SubAgentBlock({
  id,
  name,
  input,
  result,
  status,
  durationMs,
}: SubAgentBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const description = input.description || input.prompt || "Sub-agent";

  return (
    <details
      open={isExpanded}
      onToggle={(e) => setIsExpanded(e.currentTarget.open)}
      className={cn(
        "rounded-lg border",
        "border-secondary-500/30 bg-secondary-950/20"
      )}
      data-testid={`sub-agent-${id}`}
      data-status={status}
    >
      <summary className="flex items-center gap-2 p-3 cursor-pointer">
        {isExpanded ? <ChevronDown /> : <ChevronRight />}
        <GitBranch className="h-4 w-4 text-secondary-400" />
        <span className="font-medium text-sm">Task: {description}</span>
        <span className="ml-auto">
          <StatusIcon status={status} />
        </span>
      </summary>

      <div className="px-3 pb-3 ml-6 border-l-2 border-secondary-500/20 space-y-2">
        {/* Nested tool calls */}
        {result?.toolCalls.map((call, i) => (
          <ToolUseBlock
            key={`${id}-tool-${i}`}
            id={`${id}-tool-${i}`}
            name={call.name}
            input={call.input}
            result={call.result}
            status="complete"
          />
        ))}

        {/* Summary */}
        {result?.summary && (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {result.summary}
          </div>
        )}
      </div>
    </details>
  );
}
```

### Step 1.4: Update AssistantMessage to Route Task Tools

**File:** `src/components/thread/assistant-message.tsx`

Add case for Task tool in the switch statement:

```typescript
case "tool_use": {
  const state = toolStates?.[block.id] ?? { status: "running" as const };

  // Check if this is a Task tool (sub-agent)
  const isTaskTool = block.name.toLowerCase() === "task";

  if (isTaskTool) {
    return (
      <SubAgentBlock
        key={block.id}
        id={block.id}
        name={block.name}
        input={block.input as { description?: string; prompt?: string }}
        result={state.result ? parseTaskToolResult(state.result) : undefined}
        status={state.status}
        durationMs={state.durationMs}
      />
    );
  }

  return (
    <ToolUseBlock
      key={block.id}
      // ... existing props
    />
  );
}
```

### Step 1.5: Add Visual Indentation CSS

**File:** `src/components/thread/sub-agent-block.tsx` (styles)

Use consistent indentation pattern:
- Sub-agent block: left border + padding
- Nested tools: additional indent
- Visual hierarchy through color/opacity

```css
/* Indentation levels */
.sub-agent-content {
  @apply ml-6 pl-4 border-l-2 border-secondary-500/20;
}

.sub-agent-content .sub-agent-content {
  @apply border-secondary-500/10;  /* Lighter for deeper nesting */
}
```

---

## Testing Plan

### Unit Tests

**File:** `src/lib/utils/task-tool-parser.test.ts`

```typescript
describe("parseTaskToolResult", () => {
  it("parses plain text result", () => {
    const result = parseTaskToolResult("Found 3 files");
    expect(result.summary).toBe("Found 3 files");
    expect(result.toolCalls).toEqual([]);
  });

  it("extracts tool calls if present in structured result", () => {
    // Test depends on actual SDK output format
  });
});
```

### UI Tests

**File:** `src/components/thread/sub-agent-block.ui.test.tsx`

```typescript
describe("SubAgentBlock", () => {
  it("renders collapsed by default", () => {
    render(<SubAgentBlock ... />);
    expect(screen.getByTestId("sub-agent-123")).not.toHaveAttribute("open");
  });

  it("expands to show nested tool calls", () => {
    // ...
  });

  it("shows status indicator", () => {
    // ...
  });
});
```

### Integration Tests

```typescript
describe("AssistantMessage with Task tool", () => {
  it("renders Task tool as SubAgentBlock", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "123", name: "Task", input: { description: "Search code" } }
        ]
      }
    ];

    render(<AssistantMessage messages={messages} messageIndex={0} />);
    expect(screen.getByTestId("sub-agent-123")).toBeInTheDocument();
  });
});
```

---

## Open Questions

1. **What does the Task tool actually return?**
   - Need to run real sub-agent and inspect output
   - This determines how much we can show in the UI

2. **Can we hook into sub-agent execution?**
   - PostToolUse hook only fires after tool completes
   - For real-time updates, may need SDK changes

3. **Should parallel sub-agents be displayed differently?**
   - Multiple Task calls in same turn
   - Side-by-side vs. stacked layout

4. **Navigation between parent/child threads**
   - If we add first-class threads, how does user navigate?
   - Breadcrumbs? Tree view? Back button?

---

## File Summary

| File | Action | Lines |
|------|--------|-------|
| `src/lib/utils/task-tool-parser.ts` | Create | ~50 |
| `src/components/thread/sub-agent-block.tsx` | Create | ~100 |
| `src/components/thread/assistant-message.tsx` | Modify | +15 |
| `src/components/thread/index.ts` | Modify | +1 |

### Test Files

| File | Lines |
|------|-------|
| `src/lib/utils/task-tool-parser.test.ts` | ~50 |
| `src/components/thread/sub-agent-block.ui.test.tsx` | ~80 |

---

## Future Phases (Out of Scope for Phase 1)

### Phase 2: First-Class Sub-Agent Threads
- Add `parentThreadId` to thread metadata
- Store sub-agent conversations separately
- Navigate to sub-agent thread view

### Phase 3: Real-Time Sub-Agent Updates
- Hook into sub-agent execution
- Stream sub-agent tool calls to UI
- Progressive disclosure as sub-agent works

### Phase 4: Sub-Agent Metrics
- Track cost per sub-agent
- Duration breakdown
- Success/failure rates

---

## Next Steps

1. **Investigate Task tool output** - Run agent with Task tool, capture raw output
2. **Create parser** - Based on findings, implement `parseTaskToolResult`
3. **Build SubAgentBlock** - Visual component with indentation
4. **Integrate** - Route Task tools to new component
5. **Test** - Verify with real sub-agent execution
