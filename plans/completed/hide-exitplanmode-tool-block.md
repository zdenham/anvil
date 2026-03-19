# Hide ExitPlanMode Tool Block in Thread View

## Summary
Hide the `ExitPlanMode` tool_use block from rendering in the conversation thread. Display-only change — no functional impact.

## Phases

- [x] Add filter in assistant-message.tsx to skip ExitPlanMode tool blocks

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Details

**File:** `src/components/thread/assistant-message.tsx`

**Change:** In the `tool_use` case (line 89), return `null` when the tool name is `ExitPlanMode`:

```tsx
case "tool_use": {
  const toolName = (block as ContentBlock & { name: string }).name;
  if (toolName === "ExitPlanMode") return null;
  return (
    <ToolBlockRouter
      key={(block as ContentBlock & { id: string }).id}
      toolUseId={(block as ContentBlock & { id: string }).id}
      toolName={toolName}
      toolInput={(block as ContentBlock & { input: unknown }).input as Record<string, unknown>}
    />
  );
}
```

This avoids rendering the block entirely. The SDK still calls the tool normally — we just don't show it in the thread.
