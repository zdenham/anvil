# 01 — Remove Folder Icons from Directory Entries

**Parent**: [readme.md](./readme.md)

## Problem

In `file-entry-list.tsx`, folder entries render both a `ChevronRight` and a `<img>` folder icon. The icon is redundant — the chevron already communicates "this is a directory."

## Current Code

```tsx
{entry.isDirectory ? (
  <>
    <ChevronRight size={12} className="flex-shrink-0 text-surface-400" />
    <img src={getFolderIconUrl(entry.name)} alt="" className="w-4 h-4 flex-shrink-0" />
  </>
) : (
  <img src={getFileIconUrl(entry.name)} alt="" className="w-4 h-4 flex-shrink-0" />
)}
```

## Changes

### `src/components/file-browser/file-entry-list.tsx`

- Remove the `<img>` tag for folder entries — keep only `ChevronRight`
- Remove the `getFolderIconUrl` import if no longer used
- Consider whether chevron should rotate on expand once phase 3 (expandable tree) is implemented — for now, keep it static pointing right

### `src/components/file-browser/file-icons.ts`

- `getFolderIconUrl` may become dead code after this change. If phase 3 doesn't need it either, delete it. Otherwise leave it for now.

## Verification

- Files still show their material icons
- Folders show only a chevron, no icon
- Visual spacing looks balanced (no extra gap where the icon was)
