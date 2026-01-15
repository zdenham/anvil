# Sub-Plan: CodeBlock Component

## Overview

Create the main code block component with syntax highlighting, copy button, and collapsible functionality.

## Dependencies

- **Requires:** `01-use-code-highlight-hook.md` (uses the `useCodeHighlight` hook)

## Parallel Execution Group

**Group 2** - Must wait for Group 1 to complete

## Scope

### File to Create

`src/components/thread/code-block.tsx` (~100 lines)

### Interface

```typescript
interface CodeBlockProps {
  code: string;
  language?: string;
  isStreaming?: boolean;
  className?: string;
}
```

### Component Structure

The file will contain one main component with three inline sub-components:

1. **CodeBlock** (main component):
   - State: `isExpanded` (default: `code.split('\n').length <= 20`)
   - State: `isCopied` for copy button feedback
   - Calls `useCodeHighlight(code, language)`

2. **CopyButton** (~25 lines inline):
   - Handles clipboard copy
   - Shows copied feedback for 2 seconds

3. **HighlightedCode** (~20 lines inline):
   - Renders token arrays as styled spans

4. **CollapsedOverlay** (~15 lines inline):
   - Shows gradient overlay with expand button

5. **CollapseToggle** (~10 lines inline):
   - Appears in the header when code is expanded AND exceeds 20 lines
   - Allows user to re-collapse the code block after expanding
   - Uses `ChevronUp` icon from lucide-react

### Render Structure

```tsx
<div className="relative group rounded-lg border border-zinc-800 bg-zinc-900">
  {/* Header bar with language + copy button */}
  {/* Code content with overflow-x-auto */}
  {/* Collapsed overlay if >20 lines and not expanded */}
</div>
```

### Reference Files

- `src/components/thread/tool-use-block.tsx` - Complex collapsible pattern
- `src/components/diff-viewer/highlighted-line.tsx` - Token rendering pattern
- `src/components/spotlight/spotlight.tsx` - `navigator.clipboard` pattern

### Icons Required

- `Copy` from lucide-react
- `Check` from lucide-react
- `ChevronUp` from lucide-react (for collapse toggle)
- `ChevronDown` from lucide-react (for expand button in overlay)

## Tests

### File to Create

`src/components/thread/code-block.ui.test.tsx`

### Test Categories

**Rendering:**
1. Renders code content
2. Displays language label
3. Shows unstyled code while loading

**Copy Functionality:**
1. Copies code to clipboard on button click
2. Shows copied feedback after copying
3. Resets copied state after 2 seconds

**Collapsing:**
1. Collapses long code blocks by default (>20 lines)
2. Expands when clicking expand button
3. Does not collapse short code blocks
4. Shows collapse toggle button in header when expanded and >20 lines
5. Collapse toggle re-collapses the code block

**Accessibility:**
1. Has accessible copy button with aria-label
2. Uses semantic code element

### Edge Cases File

`src/components/thread/code-block-edge-cases.ui.test.tsx`

1. Handles empty code
2. Handles unknown language
3. Handles very long lines without breaking layout
4. Handles code with special characters (XSS prevention)
5. Handles code with unicode characters
6. Handles rapid content updates gracefully

## Acceptance Criteria

- [ ] Component exports `CodeBlock` function
- [ ] Syntax highlighting works via useCodeHighlight hook
- [ ] Copy button copies code to clipboard
- [ ] Copy button shows feedback for 2 seconds
- [ ] Long code blocks (>20 lines) are collapsed by default
- [ ] Expand button reveals full code
- [ ] Horizontal scroll for long lines
- [ ] All UI tests pass via `pnpm test:ui`
- [ ] File stays under 250 lines
- [ ] TypeScript compiles without errors

## Export Updates

After creating this component, update `src/components/thread/index.ts` to export it:

```typescript
export { CodeBlock } from "./code-block";
```

## Estimated Lines

~100 lines for implementation + ~150 lines for tests
