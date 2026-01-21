# Markdown Table Rendering Fix

## Problem

Tables in chat messages are not rendering as proper HTML tables. Instead, they appear as raw pipe-delimited text or malformed HTML.

### Example of Bad Output

The agent sends a markdown table like:
```
| File | Change |
|------|--------|
| `core/types/events.ts` | Added `PLAN_DETECTED` event |
```

But it renders as raw HTML paragraph tags with the table syntax visible, not as an actual table.

## Root Cause

After investigating the markdown rendering system, the issue is clear:

**The `remark-gfm` plugin is not installed or configured.**

The current setup in `src/components/thread/markdown-renderer.tsx`:
```tsx
<ReactMarkdown components={components}>
  {content}
</ReactMarkdown>
```

React-markdown by default only supports CommonMark, which does **not** include tables. Tables are part of GitHub Flavored Markdown (GFM) and require the `remark-gfm` plugin.

### Current Dependencies
- `react-markdown`: ^10.1.0 (installed)
- `remark-gfm`: **NOT INSTALLED**

## Solution

### Step 1: Install remark-gfm

```bash
pnpm add remark-gfm
```

### Step 2: Update MarkdownRenderer

Modify `src/components/thread/markdown-renderer.tsx` to include the plugin:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ... existing code ...

<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={components}
>
  {content}
</ReactMarkdown>
```

### Step 3: Add Custom Table Styling (Optional but Recommended)

Add custom renderers for table elements to match the app's design system:

```tsx
const components = {
  // ... existing components ...

  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  ),

  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-zinc-800/50 border-b border-zinc-700">
      {children}
    </thead>
  ),

  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-zinc-800">
      {children}
    </tbody>
  ),

  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="hover:bg-zinc-800/30">
      {children}
    </tr>
  ),

  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-medium text-zinc-300">
      {children}
    </th>
  ),

  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 text-zinc-400">
      {children}
    </td>
  ),
};
```

### Step 4: Update Other Markdown Instances

Check if any other files use ReactMarkdown and need the same fix:

1. `src/components/workspace/task-overview.tsx` - Uses ReactMarkdown, may need GFM support
2. `src/components/workspace/action-panel.tsx` - Check if it renders markdown with tables

## Additional GFM Features Enabled

Adding `remark-gfm` will also enable:
- ~~Strikethrough~~ text
- Autolinks (URLs automatically become links)
- Task lists (`- [ ]` and `- [x]`)

These are generally desirable for chat applications.

## Testing

After implementation:

1. Send a message with a markdown table and verify it renders as an HTML table
2. Check that inline code within table cells still renders correctly
3. Verify table is responsive/scrollable on narrow viewports
4. Test strikethrough and task lists work as expected
5. Ensure no regression in existing markdown features (code blocks, links, etc.)

## Files to Modify

1. `package.json` - Add remark-gfm dependency
2. `src/components/thread/markdown-renderer.tsx` - Add plugin and table components
3. `src/components/workspace/task-overview.tsx` - Add plugin if tables needed there
4. `src/index.css` - Add any additional table styles if prose defaults aren't sufficient

## Estimated Complexity

Low - This is a straightforward plugin addition with optional styling customization.
