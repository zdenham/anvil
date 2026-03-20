# Hide duration counter when 0 seconds

## Problem

When a tool's computed duration is 0 seconds, the UI displays "0s" next to tool blocks (Bash, Task, Sub-agent). This is noise — a 0s duration isn't useful information.

## Solution

In the `useToolDuration` hook (`src/hooks/use-tool-duration.ts`), return `null` when the computed duration rounds to 0 seconds. This causes all three render sites (BashToolBlock, TaskToolBlock, SubAgentReferenceBlock) to hide the counter automatically, since they already gate on `duration && (...)`.

## Key files

- `src/hooks/use-tool-duration.ts` — the only file that needs changing

## Change

In `useToolDuration`, after computing the formatted duration string, check if `totalSeconds === 0` and return `null`:

```ts
// In the formatDuration helper (local to this file):
// No change needed — it correctly returns "0s" for 0ms

// In useToolDuration, after computing the duration ms:
if (status === "running") {
  const ms = now - startedAt;
  if (ms < 1000) return null;  // Hide 0s counter
  return formatDuration(ms);
}

const end = completedAt ?? Date.now();
const ms = end - startedAt;
if (ms < 1000) return null;  // Hide 0s counter
return formatDuration(ms);
```

No changes needed at the render sites — they already check `{duration && (...)}`.

## Phases

- [x] Update `useToolDuration` to return `null` for sub-second durations

- [x] Verify existing tests pass, update `formatDuration` test expectations if needed

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---