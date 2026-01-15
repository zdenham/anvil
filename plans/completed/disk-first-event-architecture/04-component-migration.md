# Plan 04: Component Migration

## Dependencies

- **Requires Plan 01** (agent writes disk-first)
- **Requires Plan 03** (listeners update store from disk)

## Goal

Update components to use `useThreadUIStore` instead of `useStreamingThread`.

## Files to Modify

| File | Action |
|------|--------|
| `src/components/workspace/task-workspace.tsx` | Replace useStreamingThread with useThreadUIStore |
| `src/hooks/use-action-state.ts` | Remove useStreamingThread usage |

## Implementation

### 1. Update `task-workspace.tsx`

```typescript
// BEFORE
const { streamingState } = useStreamingThread(activeThreadId);
const { threadState: diskState, status: diskStatus } = useThreadMessages(activeThreadId);
const threadState = streamingState ?? diskState;

// AFTER
const { messages, fileChanges, status } = useThreadUIStore();
// Or keep useThreadMessages for initial load, ThreadUIStore handles live updates
```

Remove:
- Import of `useStreamingThread`
- Any `streamingState` references
- Fallback logic between streaming and disk state

### 2. Update `use-action-state.ts`

Remove:
- Import of `useStreamingThread`
- Any usage of streaming state

Replace with:
- Direct usage of `useThreadUIStore` for status/state

## Migration Pattern

Components should now follow this pattern:

```typescript
// Subscribe to store
const { messages, fileChanges, status } = useThreadUIStore();

// Status derives from store (populated by listeners from disk)
const isRunning = status === "running";
const isComplete = status === "completed";
```

## Notes

- This is the critical migration step
- After this, components only read from store
- Store is updated by listeners reading from disk

## Validation

- Components render messages from store
- Status updates when agent completes
- No stuck loading states
- File changes display correctly
