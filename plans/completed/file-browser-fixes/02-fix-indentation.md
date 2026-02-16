# 02 — Fix Files Item Indentation in Tree Menu

**Parent**: [readme.md](./readme.md)

## Problem

The "Files" button in the left sidebar uses `pl-5` (20px) which doesn't align with sibling items (threads, terminals, plans) that use `INDENT_BASE` (8px) via inline `paddingLeft`.

The `FolderOpen` icon in Files should align horizontally with the status dots on threads and the terminal icon on terminal items.

## Current Code

```tsx
// files-item.tsx — uses fixed Tailwind class
className="flex items-center gap-2 w-full pl-5 pr-2 py-1 text-xs"
<FolderOpen size={13} className="flex-shrink-0" />
```

```tsx
// terminal-item.tsx — uses dynamic indent from shared constants
const indentPx = INDENT_BASE + (item.depth * INDENT_STEP); // 8 + 0*8 = 8px at depth 0
style={{ paddingLeft: `${indentPx}px` }}
<span className="flex-shrink-0 w-3 flex items-center justify-center">
  <Terminal size={10} />
</span>
```

## Changes

### `src/components/tree-menu/files-item.tsx`

- Replace `pl-5` with inline `style={{ paddingLeft: '${INDENT_BASE}px' }}` using the shared constant from `use-tree-keyboard-nav`
- Import `INDENT_BASE` from `./use-tree-keyboard-nav`
- Match the icon wrapper pattern used by terminal/thread items: wrap icon in `<span className="flex-shrink-0 w-3 flex items-center justify-center">`
- Use `gap-1.5` instead of `gap-2` to match thread/terminal item spacing

## Verification

- The Files icon should align horizontally with thread status dots and terminal icons
- Visual consistency across all items at depth 0
- Check at different sidebar widths to confirm alignment holds
