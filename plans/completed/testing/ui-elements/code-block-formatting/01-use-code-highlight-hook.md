# Sub-Plan: useCodeHighlight Hook

## Overview

Create the async highlighting hook that provides syntax-highlighted tokens for code blocks.

## Dependencies

- **None** - This is a foundational component that can be built first.

## Parallel Execution Group

**Group 1** - Can execute in parallel with `02-inline-code-component.md`

## Scope

### File to Create

`src/hooks/use-code-highlight.ts` (~45 lines)

### Interface

```typescript
interface UseCodeHighlightResult {
  tokens: ThemedToken[][] | null;
  isLoading: boolean;
}

export function useCodeHighlight(
  code: string,
  language: string
): UseCodeHighlightResult
```

### Implementation Details

1. Use `useState` for tokens and loading state
2. Use `useEffect` to trigger async highlighting via `highlightCode()` from `@/lib/syntax-highlighter`
3. Debounce during streaming: 100ms delay after last code change
4. Return `null` tokens while loading (allows fallback to unstyled code)
5. Use `useRef` to track previous code+language to avoid re-highlighting unchanged code

### Reference Files

- `src/hooks/use-reduced-motion.ts` - Hook structure pattern
- `src/lib/syntax-highlighter.ts` - The `highlightCode()` function to call

## Tests

### File to Create

`src/hooks/use-code-highlight.test.ts`

### Test Cases

1. Returns loading state initially
2. Returns tokens after highlighting completes
3. Debounces rapid code changes (only calls highlightCode once after debounce)
4. Handles highlighting errors gracefully (returns null tokens)
5. Skips re-highlighting when code+language unchanged

## Acceptance Criteria

- [ ] Hook exports `useCodeHighlight` function
- [ ] Returns `{ tokens, isLoading }` object
- [ ] Debounces with 100ms delay
- [ ] Handles errors gracefully (no crashes, returns null tokens)
- [ ] All tests pass via `pnpm test`
- [ ] TypeScript compiles without errors

## Edge Case: Initial Load

The first call to `highlightCode()` may be slower due to Shiki initialization. Shiki lazily loads language grammars and themes on first use, which can add ~100-200ms to the initial highlight call. Subsequent calls will be fast.

**Handling:**
- The hook already returns `isLoading: true` during highlighting, so the UI can show unstyled code as a fallback
- No special handling is needed, but be aware of this when testing initial render performance
- Consider pre-warming Shiki in development if this becomes noticeable

## Estimated Lines

~45 lines for implementation + ~60 lines for tests
