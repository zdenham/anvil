# 05: Thread View Read-Only Mode

When viewing a sub-agent thread, display in read-only mode with breadcrumb navigation.

## Phases

- [x] Add breadcrumb component for sub-agent threads
- [x] Hide input/cancel for sub-agent threads
- [x] Test read-only behavior

---

## Thread Content Changes

```tsx
// src/components/content-pane/thread-content.tsx

function ThreadContent({ thread }) {
  const isSubAgent = !!thread.parentThreadId;

  return (
    <div>
      {/* Breadcrumb for sub-agents */}
      {isSubAgent && (
        <SubAgentBreadcrumb
          parentThreadId={thread.parentThreadId}
          currentName={thread.name}
        />
      )}

      <MessageList messages={thread.messages} />

      {/* Hide input for sub-agents */}
      {!isSubAgent && (
        <ThreadInput threadId={thread.id} />
      )}
    </div>
  );
}
```

## Breadcrumb Component

```tsx
function SubAgentBreadcrumb({ parentThreadId, currentName }) {
  const parentThread = useThread(parentThreadId);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
      <Link to={`/threads/${parentThreadId}`}>
        <ArrowLeft className="h-4 w-4" />
        {parentThread?.name ?? "Parent Thread"}
      </Link>
      <ChevronRight className="h-4 w-4" />
      <span>{currentName}</span>
    </div>
  );
}
```

## Read-Only Detection

A thread is read-only if `parentThreadId !== undefined`. No separate `isReadOnly` flag needed.

## Key Behaviors

- Breadcrumb shows: "← Parent Name > Current Name"
- Parent name truncated with ellipsis if needed
- No input field for sub-agents
- No cancel button for sub-agents
- User can navigate away freely while sub-agent runs

## Files to Modify

- `src/components/content-pane/thread-content.tsx` - Conditional input, breadcrumb
- Create `SubAgentBreadcrumb` component (inline or separate file)
