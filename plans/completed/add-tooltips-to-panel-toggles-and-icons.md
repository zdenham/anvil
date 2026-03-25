# Add Tooltips to Panel Toggles and Icon Buttons

Replace native `title` attributes and bare `aria-label`-only icon buttons with the existing `<Tooltip>` component (`@/components/ui/tooltip`) for a consistent, styled hover experience.

## Reference Pattern

The `<Tooltip>` component wraps a trigger element and shows a styled popup on hover. Existing usage in `tree-panel-header.tsx` and `right-panel-tab-bar.tsx`:

```tsx
import { Tooltip } from "@/components/ui/tooltip";

<Tooltip content="Refresh" side="bottom">
  <button ...><RefreshCw size={12} /></button>
</Tooltip>
```

## Phases

- [x] Phase 1: Window titlebar panel toggles
- [x] Phase 2: Content pane header icons
- [x] Phase 3: Control panel header icons
- [x] Phase 4: Right panel subheader refresh button
- [x] Phase 5: Sidebar collapse button
- [x] Phase 6: Logs toolbar icon buttons

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Window titlebar panel toggles

**File:** `src/components/window-titlebar/window-titlebar.tsx`

These three buttons have no tooltip or title — just bare icons. Wrap each with `<Tooltip>`:

| Button | Icon | Tooltip text | Side |
|--------|------|-------------|------|
| Left panel toggle | `PanelLeft` | `"Toggle sidebar"` | `"bottom"` |
| Terminal panel toggle | `PanelBottom` | `"Toggle terminal"` | `"bottom"` |
| Right panel toggle | `PanelRight` | `"Toggle right panel"` | `"bottom"` |

Import `Tooltip` from `@/components/ui/tooltip`.

## Phase 2: Content pane header icons

**File:** `src/components/content-pane/content-pane-header.tsx`

Multiple sub-headers use `title=` and/or `aria-label=` on icon buttons. Replace `title` attrs with `<Tooltip>` wrappers. Keep `aria-label` for accessibility but remove `title` (tooltip replaces it).

### ThreadHeader buttons:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Tab toggle (conversation→changes) | Dynamic: `"View changes"` / `"View conversation"` | `"bottom"` |
| Pop out to window | `"Pop out to window"` | `"bottom"` |
| Close pane | `"Close"` | `"bottom"` |
| Cancel agent | Skip — already has visible text label |

### PlanHeader buttons:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Pop out to window | `"Pop out to window"` | `"bottom"` |
| Close pane | `"Close"` | `"bottom"` |

### SimpleHeader:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Close pane | `"Close"` | `"bottom"` |

### FileHeader:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Close pane | `"Close"` | `"bottom"` |

### TerminalHeader:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Archive terminal | `"Archive terminal"` | `"bottom"` |
| Close pane | `"Close"` | `"bottom"` |

### ChangesHeader:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Close pane | `"Close"` | `"bottom"` |

Remove `title=` attributes from all buttons that get a `<Tooltip>` wrapper.

## Phase 3: Control panel header icons

**File:** `src/components/control-panel/control-panel-header.tsx`

### PlanModeHeader:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Open in main window | `"Open in main window"` | `"bottom"` |
| Close panel | `"Close (Escape)"` | `"bottom"` |

### ThreadModeHeader:
| Button | Tooltip content | Side |
|--------|----------------|------|
| Tab toggle | Dynamic: `"View changes"` / `"View conversation"` | `"bottom"` |
| Open in main window | `"Open in main window"` | `"bottom"` |
| Close panel | `"Close (Escape)"` | `"bottom"` |

Remove `title=` attributes from wrapped buttons.

## Phase 4: Right panel subheader refresh button

**File:** `src/components/right-panel/right-panel-subheader.tsx`

| Button | Tooltip content | Side |
|--------|----------------|------|
| Refresh | `"Refresh"` | `"bottom"` |

Import `Tooltip` from `@/components/ui/tooltip`. Remove the `title="Refresh"` attribute.

## Phase 5: Sidebar collapse button

**File:** `src/components/workspace/sidebar-collapse-button.tsx`

| Button | Tooltip content | Side |
|--------|----------------|------|
| Collapse/Expand | Dynamic: `"Collapse sidebar"` / `"Expand sidebar"` | `"right"` |

Import `Tooltip` from `@/components/ui/tooltip`.

## Phase 6: Logs toolbar icon buttons

**File:** `src/components/main-window/logs-toolbar.tsx`

| Button | Tooltip content | Side |
|--------|----------------|------|
| Copy logs | Dynamic: `"Copy logs"` / `"Copied!"` / `"No logs to copy"` | `"bottom"` |
| Clear all logs | `"Clear all logs"` | `"bottom"` |
| Profile button | Dynamic based on profiling state (keep existing `title` logic, move to `<Tooltip content={...}>`) | `"bottom"` |

Import `Tooltip` from `@/components/ui/tooltip`. Remove `title=` attributes from wrapped buttons.
