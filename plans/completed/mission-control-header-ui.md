# Mission Control Header UI Restoration

## Overview

The new Mission Control (UnifiedInbox) is missing UI elements that existed in the old Task Pane:
- **Title** - Clear header identifying the view
- **Search bar** - Filter threads/plans by text (new feature, not in original)
- **Refresh button** - Manually reload data from disk
- **Close button** - Close the panel (optional, for standalone panel use)

---

## Reference: Old Task Pane UI (from git history)

The deleted `tasks-panel.tsx` (commit a092a30) had this exact header structure:

```tsx
<header className="px-4 py-3 border-b border-surface-700/50 flex-shrink-0 flex items-center justify-between gap-4">
  <h1 className="text-sm font-medium text-surface-100">Tasks</h1>
  <div className="flex items-center gap-1">
    <button
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="p-1.5 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
      title="Refresh tasks"
    >
      <RefreshIcon className={isRefreshing ? "animate-spin" : ""} />
    </button>
    <button
      onClick={handleClose}
      className="p-1.5 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition-colors"
      title="Close (Escape)"
    >
      <CloseIcon />
    </button>
  </div>
</header>
```

Key styling details:
- `flex-shrink-0` on header to prevent shrinking
- `justify-between` to push title left, buttons right
- `gap-4` between title and button group
- `gap-1` between buttons
- `p-1.5 rounded` on buttons (not `rounded-md`)
- `transition-colors` on buttons
- `disabled:opacity-50` for disabled state
- Custom SVG icons (not Lucide)

---

## Implementation

### InboxHeader Component

**File:** `src/components/inbox/inbox-header.tsx`

Matches the original TasksPanel header design with an added search bar:

```tsx
interface InboxHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onClose?: () => void;
}

export function InboxHeader({
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing,
  onClose,
}: InboxHeaderProps) {
  return (
    <header className="px-4 py-3 border-b border-surface-700/50 flex-shrink-0 flex items-center justify-between gap-4">
      <h1 className="text-sm font-medium text-surface-100">Mission Control</h1>

      {/* Search bar - flexible width in the middle */}
      <div className="flex-1 max-w-md">
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search threads and plans..."
        />
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshIcon className={isRefreshing ? "animate-spin" : ""} />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition-colors"
            title="Close (Escape)"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </header>
  );
}

// Custom SVG icons matching the original design
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 ${className || ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
```

### SearchInput Component

**File:** `src/components/inbox/search-input.tsx`

```tsx
import { Search, X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded-md
          text-surface-100 placeholder-surface-500
          focus:outline-none focus:ring-1 focus:ring-secondary-500 focus:border-secondary-500"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-700"
        >
          <X className="w-3 h-3 text-surface-500" />
        </button>
      )}
    </div>
  );
}
```

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Mission Control   [🔍 Search threads and plans...    ]  [↻] [×] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Thread items...                                                 │
│  Plan items...                                                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Layout breakdown:
- Title (left, fixed width)
- Search bar (center, flex-1, max-w-md)
- Button group (right): Refresh, Close

---

## Key Differences from Initial Plan

1. **Removed panel toggle** - The sidebar toggle was not part of the original TasksPanel header design
2. **Matched exact CSS classes** - Using `rounded` not `rounded-md`, added `transition-colors`, etc.
3. **Used original SVG icons** - Matching the custom RefreshIcon and CloseIcon from the old design
4. **Added `flex-shrink-0`** - Prevents header from collapsing
5. **Close button is optional** - Only shown when `onClose` prop is provided

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/components/inbox/inbox-header.tsx` | Updated | Match original TasksPanel header design |
| `src/components/inbox/search-input.tsx` | Exists | Search input (uses Lucide icons) |

---

## Success Criteria

1. Header layout matches original TasksPanel (title left, buttons right)
2. Button styling matches exactly (`p-1.5 rounded`, `transition-colors`, etc.)
3. Icons match original SVG paths
4. Refresh animation works (`animate-spin`)
5. Close button only shows when handler provided
6. Search bar sits in the middle with flexible width
