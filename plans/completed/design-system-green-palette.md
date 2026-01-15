# Design System: Navy Blue to Green Palette Migration

## Executive Summary

This plan outlines the migration from the current navy blue color scheme to a green-tinted palette. The codebase currently has **no centralized design system** - the Tailwind config is essentially empty with no custom colors defined. There are **~476 hardcoded color class usages across 80 files** that need to be consolidated.

## Current State Analysis

### Tailwind Config (Empty)
```js
// tailwind.config.js - Currently has NO custom colors
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},  // Empty!
  },
  plugins: [typography],
}
```

### CSS Variables (Fragmented)
Located in `src/index.css`:
- Thread UI palette: `--bg-chat`, `--bg-user-bubble`, `--bg-assistant-bubble`, etc.
- Spotlight colors: `--spotlight-bg`, `--spotlight-border`, `--accent-color`
- Build variants: dev (purple), canary (orange)

### Color Usage by Component Area

| Area | Files | Color Occurrences | Primary Colors Used |
|------|-------|-------------------|---------------------|
| Spotlight | 8 | ~20 | slate, indigo, orange |
| Thread | 17 | ~60 | zinc, slate, violet, blue, red, green, yellow, amber |
| Diff Viewer | 24 | ~150 | slate, emerald, red, blue, amber, zinc |
| Workspace | 14 | ~80 | slate, blue, purple, amber, green, red |
| Tasks | 10 | ~89 | slate, amber, blue, purple, emerald, red |
| Main Window | 14 | ~50 | slate, blue, violet, amber, red, green |
| Reusable/UI/Misc | 15 | ~30 | slate, indigo, green, blue, purple, orange |

### Key Patterns Identified

1. **Primary Backgrounds**: `slate-800`, `slate-900`, `slate-950` (dark navy)
2. **Primary Text**: `slate-100` through `slate-500`
3. **Accent Colors**:
   - User actions: `blue-400/500/600`
   - AI/Assistant: `violet-400`, `purple-400/500`
   - Success: `emerald-400/500`, `green-400/500`
   - Warning: `amber-400/500`, `yellow-400`
   - Error: `red-400/500/600`
   - Additions (diff): `emerald-*`
   - Deletions (diff): `red-*`
4. **Selected State**: `indigo-600/80`
5. **Borders**: `slate-600/700/800` with opacity modifiers

---

## Proposed Design System

### Phase 1: Create Centralized Tailwind Theme

Update `tailwind.config.js` with semantic color tokens:

```js
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Core background scale (green-tinted grays)
        surface: {
          50: '#f0fdf4',   // lightest
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',  // darkest
        },
        // Primary accent (replacing blue)
        accent: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        // Secondary accent (for AI/assistant elements)
        secondary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        // Semantic colors (keep these for meaning)
        success: { /* emerald */ },
        warning: { /* amber */ },
        error: { /* red */ },
        info: { /* cyan/teal */ },
      },
    },
  },
  plugins: [typography],
}
```

### Phase 2: Update CSS Variables

Update `src/index.css`:

```css
:root {
  /* Thread UI - Green-tinted palette */
  --bg-chat: #052e16;           /* surface-950 */
  --bg-user-bubble: #16a34a;    /* accent-600 */
  --bg-assistant-bubble: #14532d; /* surface-900 */
  --bg-tool-card: #166534;      /* surface-800 */
  --border-tool: #15803d;       /* surface-700 */
  --text-primary: #f0fdf4;      /* surface-50 */
  --text-secondary: #86efac;    /* surface-300 */
  --accent-tool: #f59e0b;       /* keep amber for tools */
  --destructive: #ef4444;       /* keep red */

  /* Spotlight - Green tint */
  --spotlight-bg: rgba(5, 46, 22, 0.95);
  --spotlight-border: rgba(34, 197, 94, 0.2);
  --accent-color: #22c55e;
}

/* Dev build - Keep purple for distinction */
:root[data-app-suffix="dev"] {
  --spotlight-bg: rgba(45, 25, 60, 0.95);
  --spotlight-border: rgba(139, 92, 246, 0.3);
  --accent-color: #8b5cf6;
}

/* Canary build - Keep orange for distinction */
:root[data-app-suffix="canary"] {
  --spotlight-bg: rgba(60, 35, 20, 0.95);
  --spotlight-border: rgba(249, 115, 22, 0.3);
  --accent-color: #f97316;
}
```

### Phase 3: Component Migration

#### Priority Order (by impact & complexity)

**Batch 1: Foundation (10 files)**
- [ ] `src/App.tsx` - 2 occurrences
- [ ] `src/task-main.tsx` - 4 occurrences
- [ ] `src/index.css` - CSS variables
- [ ] `tailwind.config.js` - Add theme
- [ ] Reusable components (Button, Card, Input, search-input)

**Batch 2: Main Window (14 files, ~50 occurrences)**
- [ ] `main-window-layout.tsx`
- [ ] `sidebar.tsx`
- [ ] `settings-section.tsx`
- [ ] `logs-page.tsx`, `logs-toolbar.tsx`, `log-entry.tsx`
- [ ] All settings/* files

**Batch 3: Workspace Components (14 files, ~80 occurrences)**
- [ ] `task-workspace.tsx`
- [ ] `workspace-sidebar.tsx`
- [ ] `action-panel.tsx`
- [ ] `threads-list.tsx`
- [ ] `task-header.tsx`, `task-overview.tsx`
- [ ] `chat-pane.tsx`
- [ ] Remaining workspace components

**Batch 4: Task Components (10 files, ~89 occurrences)**
- [ ] `task-card.tsx`
- [ ] `task-row.tsx`
- [ ] `kanban-column.tsx`
- [ ] `kanban-board.tsx`
- [ ] `task-toolbar.tsx`
- [ ] `delete-task-dialog.tsx`

**Batch 5: Thread Components (17 files, ~60 occurrences)**
- [ ] `thread-view.tsx`
- [ ] `message-list.tsx`
- [ ] `user-message.tsx`
- [ ] `assistant-message.tsx`
- [ ] `tool-use-block.tsx`
- [ ] `file-change-block.tsx`
- [ ] `thinking-block.tsx`
- [ ] Remaining thread components

**Batch 6: Diff Viewer (24 files, ~150 occurrences)**
- [ ] `diff-header.tsx`
- [ ] `file-header.tsx`
- [ ] `annotated-line-row.tsx`
- [ ] `highlighted-line.tsx`
- [ ] `diff-file-card.tsx`
- [ ] All error/empty/skeleton states
- [ ] Remaining diff components

**Batch 7: Spotlight & Clipboard (12 files, ~30 occurrences)**
- [ ] `spotlight.tsx`
- [ ] `SearchBar.tsx`
- [ ] `result-item.tsx`
- [ ] `results-tray.tsx`
- [ ] Clipboard components

**Batch 8: Miscellaneous**
- [ ] `global-error-view.tsx`
- [ ] `BuildModeIndicator.tsx`
- [ ] Onboarding components

---

## Color Mapping Reference

### Background Colors
| Current (Navy) | New (Green) | Usage |
|---------------|-------------|-------|
| `slate-950` | `surface-950` | Deepest backgrounds |
| `slate-900` | `surface-900` | Main backgrounds |
| `slate-800` | `surface-800` | Card/panel backgrounds |
| `slate-700` | `surface-700` | Elevated surfaces |

### Text Colors
| Current | New | Usage |
|---------|-----|-------|
| `slate-100` | `surface-100` | Primary text |
| `slate-200` | `surface-200` | Secondary text |
| `slate-300` | `surface-300` | Muted text |
| `slate-400` | `surface-400` | Placeholder/disabled |
| `slate-500` | `surface-500` | Subtle text |

### Accent Colors
| Current | New | Usage |
|---------|-----|-------|
| `blue-400/500/600` | `accent-400/500/600` | Interactive elements |
| `indigo-600` | `accent-600` | Selected states |
| `violet-400` | `secondary-400` | AI/Assistant elements |
| `purple-400/500` | `secondary-400/500` | Research/review phase |

### Semantic Colors (Keep As-Is)
| Color | Usage |
|-------|-------|
| `emerald-*` | Diff additions, success states |
| `red-*` | Diff deletions, errors, destructive |
| `amber-*` | Warnings, tools, modified files |
| `yellow-*` | Paused states, renamed files |

---

## Implementation Notes

### Search & Replace Patterns

```bash
# Background replacements
slate-950 → surface-950
slate-900 → surface-900
slate-800 → surface-800
slate-700 → surface-700
slate-600 → surface-600

# Text replacements
text-slate-100 → text-surface-100
text-slate-200 → text-surface-200
text-slate-300 → text-surface-300
text-slate-400 → text-surface-400
text-slate-500 → text-surface-500

# Accent replacements
blue-400 → accent-400 (interactive)
blue-500 → accent-500 (primary buttons)
blue-600 → accent-600 (active states)
indigo-600 → accent-600 (selected)

# Secondary replacements
violet-400 → secondary-400 (AI elements)
purple-400 → secondary-400
purple-500 → secondary-500
```

### Testing Strategy

1. Visual regression testing after each batch
2. Check all build variants (production, dev, canary)
3. Verify semantic colors still work (success/error/warning)
4. Test dark mode contrast ratios (WCAG AA minimum)

### Rollback Plan

- Keep the old colors commented in config during transition
- Use feature flag if needed: `VITE_USE_GREEN_THEME`
- Can revert individual batches if issues found

---

## Estimated Scope

- **Total files to modify**: ~80 component files + 2 config files
- **Total color occurrences**: ~476 Tailwind classes
- **CSS variables to update**: ~12 in index.css

## Dependencies

- None (pure CSS/Tailwind changes)
- No runtime code changes required
- No build process changes required

## Risks

1. **Contrast issues**: Green-on-green may reduce readability - need careful shade selection
2. **Semantic confusion**: Green = success in most UIs, need to ensure primary green doesn't conflict
3. **Build variant distinction**: Dev (purple) and canary (orange) must remain visually distinct

## Open Questions

1. Should we use a single green scale or separate surface/accent greens?
2. Keep violet for AI elements or shift to emerald/teal?
3. Update favicon/app icons to match new palette?
