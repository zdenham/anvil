# Expandable Streaming Thinking Block

## Problem

When an agent is actively streaming a thinking block, the `TrickleBlock` component renders it as a static, non-interactive element — a "Thinking" label with a truncated 100-char preview and a static `ChevronRight`. There's no way to expand and read the full thinking content while the agent is running.

Once streaming finishes and the block becomes "committed", it switches to the `ThinkingBlock` component which has full expand/collapse support via `CollapsibleBlock`.

## Approach

Make the streaming thinking block in `TrickleBlock` expandable, reusing the same `CollapsibleBlock` / `ExpandChevron` / `useToolExpandStore` pattern as the committed `ThinkingBlock`. This way:

- Users can click to expand thinking while it's streaming
- The expand state persists across the streaming → committed transition (same store key)
- The shimmer effect continues on the "Thinking" label to indicate streaming

## Phases

- [x] Update TrickleBlock to support expand/collapse for thinking blocks
- [x] Verify expand state persists through streaming → committed transition

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Update TrickleBlock

**File:** `src/components/thread/trickle-block.tsx`

Pass `threadId` and `blockKey` into `TrickleBlock` so it can use `useToolExpandStore` for expand state.

### Changes to `assistant-message.tsx`

Add `threadId` and `blockKey` props to the `TrickleBlock` call (lines 56-61):

```tsx
<TrickleBlock
  block={{ type: renderBlock.type as "text" | "thinking", content: blockContent }}
  isLast={isLast}
  workingDirectory={workingDirectory}
  threadId={threadId}
  blockKey={renderBlock.id ?? `thinking-${index}`}
/>
```

### Changes to `trickle-block.tsx`

1. Add `threadId` and `blockKey` optional props to `TrickleBlockProps`
2. Import `useToolExpandStore`, `CollapsibleBlock`, `ExpandChevron`, `ShimmerText`
3. Replace the static thinking rendering (lines 27-42) with an expandable version:

```tsx
if (block.type === "thinking") {
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId!, blockKey!)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId!, blockKey!, expanded);

  const preview =
    displayedContent.length > 100
      ? displayedContent.slice(0, 100) + "..."
      : displayedContent;

  const header = (
    <>
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <ShimmerText isShimmering className="text-sm text-zinc-200">
          Thinking
        </ShimmerText>
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <Brain className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <span className="text-xs text-zinc-500 truncate min-w-0 flex-1 italic">
          {preview}
        </span>
      </div>
    </>
  );

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      ariaLabel="Assistant reasoning"
      className="py-0.5"
      header={header}
    >
      <pre className="mt-2 ml-5 text-xs text-zinc-400 p-2 rounded bg-zinc-950 overflow-x-auto max-h-64 overflow-y-auto">
        <code className="whitespace-pre-wrap">{displayedContent}</code>
      </pre>
    </CollapsibleBlock>
  );
}
```

Note: The conditional hook calls (`useToolExpandStore` inside the `if` block) break React's rules of hooks. To fix this, extract the thinking case into a separate component `StreamingThinkingBlock` that receives `threadId`, `blockKey`, `displayedContent` as props. `TrickleBlock` delegates to it when `block.type === "thinking"`.

### New component (inline in trickle-block.tsx)

```tsx
function StreamingThinkingBlock({
  threadId,
  blockKey,
  displayedContent,
}: {
  threadId: string;
  blockKey: string;
  displayedContent: string;
}) {
  // hooks + render from above
}
```

## Phase 2: Verify state persistence

The key insight is that both `TrickleBlock` (streaming) and `ThinkingBlock` (committed) must use the **same `blockKey`** so expand state persists when a block transitions from streaming to committed.

In `assistant-message.tsx`:
- Streaming: `blockKey={renderBlock.id ?? `thinking-${index}`}` (from TrickleBlock call)
- Committed: `blockKey={renderBlock.id ?? `thinking-${index}`}` (line 83)

These already match — both use `renderBlock.id ?? `thinking-${index}``. No additional work needed here, just verify visually that expanding during streaming stays expanded after streaming completes.
