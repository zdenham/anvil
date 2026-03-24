# Sub-Agent First-Class Display

Sub-agents (Task tool invocations) are displayed as **first-class threads** in Anvil. They use the existing thread infrastructure with one additional field (`parentThreadId`), reuse all existing events and stores, and appear nested under their parent in the tree menu.

## Core Principles

1. **Sub-agents ARE threads**: Same storage (`~/.anvil/threads/`), same schema (with `parentThreadId`), same events, same store
2. **Same view, read-only**: Normal thread view with hidden input/cancel (no special "sub-agent view")
3. **No inline expansion**: Parent shows a reference block with flashing indicator; click to open child thread
4. **Tree nesting**: Sub-agents appear as children under parent thread, same pattern as nested plans
5. **Reuse everything**: No new stores, no new event types, no new naming services

## Phases

- [x] Phase 1: Data model & agent routing (01 + 02 in parallel)
- [x] Phase 2: Frontend display (03 + 04 + 05 in parallel)
- [x] Phase 3: Polish & policy (06)

---

## Subplan Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                     PHASE 1 (Parallel)                          │
│                                                                 │
│   ┌─────────────────┐         ┌─────────────────┐              │
│   │ 01-data-model   │         │ 02-agent-runner │              │
│   │ (types only)    │────────▶│ (routing logic) │              │
│   └─────────────────┘         └─────────────────┘              │
│          │                            │                         │
└──────────┼────────────────────────────┼─────────────────────────┘
           │                            │
           ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PHASE 2 (Parallel)                          │
│                                                                 │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐│
│   │ 03-tree-menu    │  │ 04-reference    │  │ 05-thread-view  ││
│   │ (nesting)       │  │ (parent block)  │  │ (read-only)     ││
│   └─────────────────┘  └─────────────────┘  └─────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PHASE 3 (Sequential)                        │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ 06-polish (system prompt, cascaded archival, testing)   │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Parallelization Notes

**Phase 1** can be worked in parallel:
- `01-data-model` defines types (no runtime code)
- `02-agent-runner` implements routing (depends on types conceptually but can be developed simultaneously)

**Phase 2** is fully parallel after Phase 1:
- `03-tree-menu` - Tree nesting logic (frontend only)
- `04-reference-block` - Parent thread UI (frontend only)
- `05-thread-view` - Read-only mode (frontend only)

**Phase 3** is sequential polish after everything works.

## SDK Background

### Task Execution Patterns

| Pattern | Blocking | Streaming | UI Approach |
|---------|----------|-----------|-------------|
| **Synchronous Task** | Yes | Full via `parent_tool_use_id` | Create child thread, stream to it |
| **Parallel Tasks** | Yes (all) | Multiple concurrent streams | Multiple child threads |
| **Background Task** | No | Polling only | Discouraged via system prompt |

### Key SDK Fields

```typescript
// Messages from sub-agents include parent_tool_use_id
type SDKAssistantMessage = {
  type: 'assistant';
  message: APIAssistantMessage;
  parent_tool_use_id: string | null;  // Non-null = sub-agent message
  uuid: UUID;
  session_id: string;
};

// Lifecycle hooks
type SubagentStartHookInput = {
  hook_event_name: 'SubagentStart';
  agent_id: string;
  agent_type: string;
};

type SubagentStopHookInput = {
  hook_event_name: 'SubagentStop';
  agent_id: string;
  agent_transcript_path: string;
};
```

## References

- SDK Types: `agents/node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`
- Message Handler: `agents/src/runners/message-handler.ts`
- Task Tool Block: `src/components/thread/tool-blocks/task-tool-block.tsx`
- Thread Types: `core/types/threads.ts`
- Tree Data Hook: `src/hooks/use-tree-data.ts`
- Design Decisions: `design-decisions.md`
