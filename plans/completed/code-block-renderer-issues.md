# Code Block Renderer Issues - Diagnosis and Proposed Fix

## Summary

Two issues have been reported with the code block renderer in the chat markdown system:
1. The "expand" button sometimes doesn't work
2. Backtick (`) characters appear at the start and end of code blocks

## Issue 1: Expand Button Not Working

### Diagnosis

The expand/collapse functionality in `src/components/thread/code-block.tsx:63-74` and `src/components/thread/code-block.tsx:146-148` appears to be correctly implemented using React state (`isExpanded`). The button handlers are straightforward:

```tsx
// CollapsedOverlay component (line 63-74)
<button onClick={onExpand} ...>
  <ChevronDown className="h-4 w-4" />
  Expand
</button>

// Usage (line 148)
<CollapsedOverlay onExpand={() => setIsExpanded(true)} />
```

**Root Cause Hypothesis:** The expand button is likely not the issue itself. The problem is likely related to **event propagation** or **focus handling**. The code block has:

```tsx
// code-block.tsx:109-117
<div
  data-code-block
  tabIndex={0}
  className={cn(
    "relative group rounded-lg border border-zinc-800 bg-zinc-900",
    "focus:outline-none focus:ring-2 focus:ring-amber-500/50",
    ...
  )}
>
```

When the expand button is inside a `relative` positioned container that has `tabIndex={0}`, clicks might be:
1. Captured by the parent's keyboard handler (`useCodeBlockKeyboard` hook, `src/hooks/use-code-block-keyboard.ts`)
2. Blocked by the gradient overlay (`CollapsedOverlay`) which has `position: absolute`
3. Not reaching the button due to z-index issues within the gradient overlay

**Additional Factor:** The `CollapsedOverlay` positions the button at the bottom of a gradient overlay:
```tsx
// code-block.tsx:65
<div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-zinc-900 to-transparent ...">
```

The button sits at `pb-3` (12px from bottom) within a 96px (`h-24`) tall overlay. If the code content is short enough that the overlay extends above the visible content, clicks might not reach the button properly.

### Proposed Fix

1. **Add explicit z-index** to the expand button:
```tsx
// In CollapsedOverlay component
<button
  onClick={onExpand}
  className="flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors relative z-10"
>
```

2. **Add `pointer-events-auto`** to ensure button is clickable through the overlay:
```tsx
<div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-zinc-900 to-transparent flex items-end justify-center pb-3 pointer-events-none">
  <button
    onClick={onExpand}
    className="... pointer-events-auto"
  >
```

3. **Stop event propagation** to prevent parent handlers from interfering:
```tsx
const handleExpand = (e: React.MouseEvent) => {
  e.stopPropagation();
  onExpand();
};
```

---

## Issue 2: Backtick Characters at Start and End of Code Blocks

### Diagnosis

**Root Cause:** Tailwind Typography plugin's default prose styles add backtick characters around `<code>` elements via CSS pseudo-elements:

```css
/* @tailwindcss/typography default styles */
code::before {
  content: "`";
}
code::after {
  content: "`";
}
```

These styles are supposed to be disabled for code inside `<pre>` tags:
```css
pre code::before {
  content: none;
}
pre code::after {
  content: none;
}
```

**However**, in `markdown-renderer.tsx:51-53`, the default `<pre>` wrapper is being removed:

```tsx
// Remove default pre wrapper since CodeBlock handles its own container
pre: ({ children }) => <>{children}</>,
```

This means the code block's `<code>` element is no longer a child of a `<pre>` element in the DOM, so the `pre code::before` and `pre code::after` CSS rules that hide the backticks **do not apply**.

**The flow:**
1. `react-markdown` parses a fenced code block
2. It tries to render: `<pre><code>...</code></pre>`
3. Our custom `pre` component returns just the children (removing the `<pre>` wrapper)
4. Our custom `code` component returns `<CodeBlock>` which has its own structure
5. The final DOM has no `<pre>` ancestor around the inner `<code>` element
6. Therefore `prose code::before` and `prose code::after` styles apply, adding backticks

**Evidence:** Looking at `code-block.tsx:137`:
```tsx
<code>
  {isLoading || !tokens ? (
    <pre className="text-zinc-300 whitespace-pre">{code}</pre>
  ) : (
    <HighlightedCode tokens={tokens} />
  )}
</code>
```

The `<code>` element here receives the prose styling but has no `<pre>` parent (the one inside is a child, not a parent).

### Proposed Fix

**Option A: Add `before:content-none after:content-none` to the CodeBlock's code element**

In `code-block.tsx`, modify the `<code>` element:
```tsx
<code className="before:content-none after:content-none">
  {isLoading || !tokens ? (
    <pre className="text-zinc-300 whitespace-pre">{code}</pre>
  ) : (
    <HighlightedCode tokens={tokens} />
  )}
</code>
```

This is the same approach used for `InlineCode` in `inline-code.tsx:14-16`.

**Option B: Wrap CodeBlock in a `<pre>` element**

Instead of removing the `<pre>` wrapper entirely in MarkdownRenderer, let the `<pre>` element wrap the CodeBlock:

```tsx
// In markdown-renderer.tsx
pre: ({ children }) => <div className="not-prose">{children}</div>,
```

Or use the semantic `<pre>` but reset its styles:
```tsx
pre: ({ children }) => <pre className="contents">{children}</pre>,
```

**Recommended:** Option A is simpler and more direct. It explicitly removes the backticks from the CodeBlock's code element, matching the pattern already used in InlineCode.

---

## Files to Modify

1. **`src/components/thread/code-block.tsx`**
   - Line 137: Add `before:content-none after:content-none` to `<code>` className
   - Line 65-74 (CollapsedOverlay): Add `pointer-events-none` to container, `pointer-events-auto` + `relative z-10` to button
   - Line 67: Add `e.stopPropagation()` to the button's onClick handler

2. **Optionally `src/components/thread/markdown-renderer.tsx`**
   - No changes needed if Option A is chosen

---

## Testing

After fixes:

1. **Expand button:**
   - Create a code block with >20 lines
   - Verify the "Expand" button appears
   - Click the expand button - it should expand the code
   - Click the collapse button in the header - it should collapse
   - Use keyboard navigation (Enter/Space on focused code block) to toggle

2. **Backticks:**
   - Send a message with a fenced code block: ` ```typescript\nconst x = 1;\n``` `
   - Verify no backtick characters appear before/after the code block
   - Verify inline code still renders correctly with its own styling
   - Test during streaming (Streamdown) and after completion (MarkdownRenderer)
