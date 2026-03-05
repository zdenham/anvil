# Thread Render Optimization

Eliminate unnecessary re-renders in the thread message list by replacing prop drilling with context + selector-based data access, so each block only re-renders when its own data changes.

## Problem

The current render path drills large, frequently-changing objects through 5 levels:

```
ThreadContent → ThreadView → MessageList → TurnRenderer → AssistantMessage → ToolUseBlock
```

Every level receives **the entire `messages: MessageParam[]` array** and **`toolStates: Record<string, ToolExecutionState>`**. When any single tool state changes or any message is appended, every `AssistantMessage` and every `ToolUseBlock` re-renders—even those whose data hasn't changed. `React.memo` on `AssistantMessage` doesn't help because its `messages` prop is a new array reference on every store update.

### Specific issues

1. **`messages` array prop**: Passed to every `AssistantMessage` just so it can do `messages[messageIndex]`. A new message appended = all assistant messages re-render.
2. **`toolStates` record prop**: Passed to every `TurnRenderer` → `AssistantMessage`. One tool completing = all turns re-render.
3. **`isStreaming` boolean cascade**: Toggling streaming state re-renders the entire tree.
4. **Tool blocks receive pre-computed values**: `result`, `isError`, `status` are computed inside `AssistantMessage`'s render and passed as props. This couples the tool block's render lifecycle to its parent's.
5. **`workingDirectory` and `threadId` drilled everywhere**: These are stable for the lifetime of a thread view but passed through every level as props.

## Solution

### Core pattern: Context for stable values, ID-only props, selector hooks for data

```
ThreadView (provides ThreadContext: threadId, workingDirectory)
  └─ MessageList (receives turns[] for virtual list count/keys only)
       └─ TurnRenderer (receives turnIndex, messageIndex)
            ├─ UserMessage (receives messageIndex, selects own content)
            └─ AssistantMessage (receives messageIndex, selects own content blocks)
                 ├─ TextBlock (receives content string — leaf node, no change)
                 ├─ ThinkingBlock (receives content string — leaf node, no change)
                 └─ ToolBlock (receives toolUseId, selects own toolState)
```

Each component receives **one stable ID** and uses **zustand selectors** to subscribe to exactly the slice of state it needs.

## Phases

- [x] Phase 1: Thread context provider + shared selector hooks
- [x] Phase 2: Refactor AssistantMessage to select its own data
- [x] Phase 3: Refactor tool blocks to select their own state
- [x] Phase 4: Streaming isolation (remove isStreaming prop chain, derive from store)
- [x] Phase 5: Remove prop drilling from MessageList → TurnRenderer chain

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase details

See sibling files for each phase:
- [phase-1-context-and-hooks.md](./phase-1-context-and-hooks.md)
- [phase-2-assistant-message.md](./phase-2-assistant-message.md)
- [phase-3-tool-blocks.md](./phase-3-tool-blocks.md)
- [phase-4-streaming-isolation.md](./phase-4-streaming-isolation.md)
- [phase-5-remove-prop-drilling.md](./phase-5-remove-prop-drilling.md)
