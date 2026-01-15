# Stream 1: Schema Foundation

**Blocks:** All other streams
**Parallel with:** Nothing (must complete first)
**Estimated scope:** ~5 lines

## Goal

Add `toolName` to the tool execution state schema so we can track which tool was used for each tool_use_id.

## File to Modify

`core/types/events.ts`

## Implementation

Update `ToolExecutionStateSchema`:

```typescript
export const ToolExecutionStateSchema = z.object({
  status: z.enum(["running", "complete", "error"]),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  toolName: z.string().optional(),  // NEW: Track which tool was used
});
```

## Why Optional?

- Backwards compatible with existing state
- Running state gets toolName from markToolRunning
- Complete/error states preserve toolName from running state

## Verification

```bash
pnpm typecheck
```

No runtime changes - this is just schema expansion.
