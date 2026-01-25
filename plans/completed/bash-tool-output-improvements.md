# Bash Tool Output Improvements

## Summary

Address three pieces of feedback on the bash tool output block:
1. Replace internal scroll with expand/collapse pattern
2. Improve background styling to blend more natively
3. Investigate terminal ANSI color support

---

## 1. Replace Internal Scroll with Expand/Collapse

### Current State
- Output uses `max-h-96 overflow-y-auto` which creates an internal scrollbar
- Creates a "double scroll" situation when the page itself is also scrollable
- Located in `bash-tool-block.tsx:271`

### Proposed Solution
Adopt the same expand/collapse pattern used by `CodeBlock` (`src/components/thread/code-block.tsx`):

**Key changes:**
- Remove `max-h-96 overflow-y-auto` from the output `<pre>` element
- Add a `LINE_COLLAPSE_THRESHOLD` constant (e.g., 20 lines to match CodeBlock)
- When collapsed, apply `max-h-[400px] overflow-hidden` (no scrollbar)
- Add a gradient fade overlay at the bottom when collapsed
- Add an "Expand" / "Collapse" button centered at the bottom

**Implementation details:**
- Reuse or extract the `ExpandCollapseOverlay` component from `code-block.tsx`
- Consider creating a shared component in `src/components/reusable/` if we want consistency
- Persist expand state in a cache (similar to CodeBlock's `expandedStateCache`) to survive re-renders

**Files to modify:**
- `src/components/thread/tool-blocks/bash-tool-block.tsx`

---

## 2. Improve Output Background Styling

### Current State
- Output uses `bg-zinc-900` (or `bg-red-950/30` for errors)
- This creates a distinct box that doesn't blend well with the thread background

### Proposed Solution
Replace solid background with a subtle border approach:

**Option A (Recommended): Border only**
```css
/* Remove background, add subtle border */
border border-zinc-700/50 rounded
/* or for a more minimal look */
border-l-2 border-zinc-700 pl-3
```

**Option B: Very subtle background with border**
```css
bg-zinc-800/20 border border-zinc-700/30 rounded
```

**For error states:**
```css
/* Subtle error styling */
border-l-2 border-red-500/50 text-red-200/80
/* or */
border border-red-500/30 bg-red-950/10
```

**Files to modify:**
- `src/components/thread/tool-blocks/bash-tool-block.tsx`

---

## 3. Terminal ANSI Color Support

### Current State
- Output is rendered as plain text via `<code>{displayedOutput}</code>`
- No ANSI escape sequence parsing
- Claude Code's bash tool returns JSON with `stdout`/`stderr` fields as plain strings
- **The JSON format should preserve ANSI codes** if the terminal captured them

### Investigation Needed
First, verify whether ANSI codes are actually present in the output:
1. Run a command that produces colored output (e.g., `ls --color=always`, `git log --color`)
2. Check the raw `result` string to see if ANSI escape sequences are preserved
3. If codes are stripped somewhere upstream (in Claude Code or the SDK), this feature may not be feasible

### Proposed Solution (if ANSI codes are available)

**Option A: Use existing library**
- `ansi-to-html` - lightweight, converts ANSI to HTML spans
- `ansi-to-react` - React component wrapper
- `xterm.js` - full terminal emulator (overkill for this use case)

**Recommended: `ansi-to-html`**
```bash
pnpm add ansi-to-html
```

**Implementation:**
```tsx
import AnsiToHtml from 'ansi-to-html';

const ansiConverter = new AnsiToHtml({
  fg: '#d4d4d4',  // zinc-300
  bg: 'transparent',
  newline: true,
  escapeXML: true,  // Security: escape HTML in output
});

// In component:
const htmlOutput = ansiConverter.toHtml(displayedOutput);

// Render with dangerouslySetInnerHTML (safe because escapeXML is true)
<code dangerouslySetInnerHTML={{ __html: htmlOutput }} />
```

**Security considerations:**
- Ensure `escapeXML: true` to prevent XSS from command output
- The library escapes `<`, `>`, `&`, `"`, `'` characters

**Option B: Custom ANSI parser**
If we want to avoid adding a dependency, we could write a simple parser for common ANSI codes:
- `\x1b[0m` - reset
- `\x1b[1m` - bold
- `\x1b[31-37m` - foreground colors
- `\x1b[91-97m` - bright foreground colors

This would be more work but gives us full control.

**Files to modify:**
- `src/components/thread/tool-blocks/bash-tool-block.tsx`
- `package.json` (if adding dependency)

---

## Implementation Order

1. **Expand/Collapse** - Highest impact on UX, follows existing pattern
2. **Background Styling** - Quick change, easy to iterate on
3. **ANSI Colors** - Investigate first, implement if feasible

---

## Testing Plan

- [ ] Verify expand/collapse works with varying output lengths
- [ ] Test that expand state persists across re-renders
- [ ] Verify new styling looks good in both light themes (if any) and dark theme
- [ ] Test error state styling (stderr output)
- [ ] If ANSI implemented: test with `ls --color=always`, `git diff --color`, etc.
- [ ] Ensure no regression in running/completed/error states
