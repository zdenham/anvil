# 04: Sub-Agent Reference Block

When a Task tool creates a sub-agent, the parent thread shows a reference block instead of the full tool block.

## Phases

- [x] Create `SubAgentReferenceBlock` component
- [x] Modify `task-tool-block.tsx` to render reference when child exists
- [x] Wire up tool call count from child thread state
- [x] Implement flashing status indicator

---

## SubAgentReferenceBlock Component

```tsx
// src/components/thread/tool-blocks/sub-agent-reference-block.tsx

interface SubAgentReferenceBlockProps {
  toolUseId: string;
  childThreadId: string;
  name: string;
  status: ThreadStatus;
  toolCallCount: number;
}

function SubAgentReferenceBlock({
  childThreadId,
  name,
  status,
  toolCallCount
}: SubAgentReferenceBlockProps) {
  const navigate = useNavigate();
  const isRunning = status === 'running';

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-md border",
      "bg-secondary/5 hover:bg-secondary/10 cursor-pointer",
    )}>
      {/* Flashing indicator while running (reuse existing pattern) */}
      <StatusDot
        variant={isRunning ? "running" : "complete"}
        animate={isRunning}
      />

      <span className="flex-1 truncate">{name}</span>

      {toolCallCount > 0 && (
        <span className="text-xs text-muted-foreground">
          {toolCallCount} tool calls
        </span>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/threads/${childThreadId}`)}
      >
        Open <ArrowRight className="ml-1 h-3 w-3" />
      </Button>
    </div>
  );
}
```

## Task Tool Block Integration

```tsx
// src/components/thread/tool-blocks/task-tool-block.tsx

function TaskToolBlock({ toolUse, toolState, ... }) {
  // Check if this Task created a sub-agent thread
  const childThread = useThreadStore(s =>
    s.threads.find(t => t.parentToolUseId === toolUse.id)
  );

  if (childThread) {
    // Render reference block instead of full tool block
    const toolCallCount = useChildThreadToolCount(childThread.id);

    return (
      <SubAgentReferenceBlock
        toolUseId={toolUse.id}
        childThreadId={childThread.id}
        name={childThread.name}
        status={childThread.status}
        toolCallCount={toolCallCount}
      />
    );
  }

  // Fall back to normal task tool block (for non-sub-agent Tasks like background)
  return <NormalTaskToolBlock {...props} />;
}
```

## Reference Block Content

- Name (truncated with ellipsis if needed)
- Flashing status indicator while running
- Tool call count (e.g., "3 tool calls")
- "Open" button to navigate to child thread

## Empty Sub-Agent Handling

- Show flashing indicator while running
- When complete with 0 tools, show complete status (no tool count line)

## Files to Create

- `src/components/thread/tool-blocks/sub-agent-reference-block.tsx`

## Files to Modify

- `src/components/thread/tool-blocks/task-tool-block.tsx` - Conditional rendering
- Thread store (add query for child by parentToolUseId)
