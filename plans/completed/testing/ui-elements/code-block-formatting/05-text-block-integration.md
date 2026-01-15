# Sub-Plan: TextBlock Integration

## Overview

Modify the existing TextBlock component to use MarkdownRenderer for completed messages while keeping Streamdown for streaming messages.

## Dependencies

- **Requires:** `04-markdown-renderer-component.md` (uses MarkdownRenderer)

## Parallel Execution Group

**Group 4** - Must wait for Group 3 to complete

## Scope

### File to Modify

`src/components/thread/text-block.tsx` (existing file, ~50 lines after modification)

### Strategy

**Option B from the plan:** Use MarkdownRenderer for complete messages, Streamdown for streaming.

This trade-off means:
- Code blocks won't be syntax-highlighted during streaming, only after completion
- This is acceptable because streaming is fast (<5 seconds)
- Avoids complex streaming token management
- Reduces flicker during rapid updates

### Implementation

```tsx
export function TextBlock({ content, isStreaming = false, className }: TextBlockProps) {
  return (
    <div className={cn("...", className)}>
      {isStreaming ? (
        <>
          <Streamdown>{content}</Streamdown>
          <StreamingCursor />
        </>
      ) : (
        <MarkdownRenderer content={content} />
      )}
    </div>
  );
}
```

### Changes Required

1. Add import for `MarkdownRenderer`
2. Add conditional rendering based on `isStreaming` prop
3. Use Streamdown + StreamingCursor when streaming
4. Use MarkdownRenderer when not streaming

### Reference Files

- `src/components/thread/markdown-renderer.tsx` (newly created)
- Current `src/components/thread/text-block.tsx` implementation

## Tests

### File to Create/Modify

`src/components/thread/text-block.ui.test.tsx`

### Test Categories

**Streaming Mode:**
1. Uses Streamdown during streaming
2. Shows streaming cursor during streaming

**Complete Mode:**
1. Uses MarkdownRenderer when not streaming
2. Does not show streaming cursor when complete
3. Code blocks are syntax-highlighted

## Acceptance Criteria

- [ ] TextBlock uses Streamdown when `isStreaming={true}`
- [ ] TextBlock uses MarkdownRenderer when `isStreaming={false}`
- [ ] Streaming cursor appears only during streaming
- [ ] Code blocks are highlighted in non-streaming mode
- [ ] All UI tests pass via `pnpm test:ui`
- [ ] No regressions in existing TextBlock behavior
- [ ] TypeScript compiles without errors

## Style Ownership Clarification

**Prose styles ownership:**

- **MarkdownRenderer** owns the prose container styles (`prose prose-invert prose-sm max-w-none`)
- **TextBlock** should NOT add prose styles - it delegates all text rendering to either Streamdown (streaming) or MarkdownRenderer (complete)
- **CodeBlock** and **InlineCode** do NOT add prose styles - they are styled independently

This separation ensures:
1. No duplicate/conflicting prose classes
2. Clear responsibility: MarkdownRenderer handles all markdown typography
3. CodeBlock can be used standalone outside of markdown context if needed

**If Streamdown already applies prose styles:** Ensure the styles are consistent between Streamdown and MarkdownRenderer, or consider extracting shared prose class names to a constant.

## Estimated Lines

~50 lines for implementation + ~40 lines for tests
