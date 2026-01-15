# Plan 05: Hook Cleanup

## Dependencies

- **Requires Plan 04** (components migrated to store)

## Goal

Delete deprecated hooks that maintained duplicate state.

## Files to Modify

| File | Action |
|------|--------|
| `src/hooks/use-streaming-thread.ts` | **DELETE** |
| `src/hooks/index.ts` | Remove `useStreamingThread` export |
| `src/hooks/use-thread-messages.ts` | **Consider deleting** if redundant |

## Implementation

### 1. Delete `use-streaming-thread.ts`

```bash
rm src/hooks/use-streaming-thread.ts
```

### 2. Update `src/hooks/index.ts`

Remove the export:

```typescript
// DELETE this line:
export { useStreamingThread } from "./use-streaming-thread";
```

### 3. Consider `use-thread-messages.ts`

If `ThreadUIStore` is now the single source of truth, `useThreadMessages` may be redundant.

**Options:**
- Delete if listeners handle initial load when thread is selected
- Keep if used for initial disk read before streaming starts

Decision depends on whether listeners are wired to load state when a thread becomes active.

## Validation

- Build succeeds with no missing imports
- TypeScript compilation clean
- No references to deleted hooks remain

## Cleanup Checklist

- [ ] Delete `use-streaming-thread.ts`
- [ ] Remove export from `index.ts`
- [ ] Search codebase for any remaining `useStreamingThread` references
- [ ] Evaluate `use-thread-messages.ts` necessity
- [ ] Run full build and type check
