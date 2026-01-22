# Status Dots and Legend Consolidation

## Overview

Restore the legend that used to appear in `TasksPage` and consolidate all status dot styling into reusable components. The legend explains the color meanings (Running, Unread, Read) for items in the inbox.

## Current State Analysis

### What We Lost
The original `TaskLegend` (from commit `d0d978e`) was a simple footer component:
```tsx
// src/components/shared/task-legend.tsx (deleted)
<div className="flex items-center gap-4 text-xs text-surface-500">
  <div className="flex items-center gap-1.5">
    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
    <span>Running</span>
  </div>
  <div className="flex items-center gap-1.5">
    <span className="w-2 h-2 rounded-full bg-blue-500" />
    <span>Unread</span>
  </div>
  <div className="flex items-center gap-1.5">
    <span className="w-2 h-2 rounded-full bg-zinc-400" />
    <span>Read</span>
  </div>
</div>
```

### Current Dot Implementations

**1. `src/utils/thread-colors.ts`** - Utility functions for dot colors:
- Running: `bg-emerald-500` + `animate-pulse`
- Unread: `bg-accent-500`
- Read: `bg-zinc-400`

**2. `src/components/inbox/inbox-item.tsx`** - Uses `getThreadDotColor()` and `getPlanDotColor()`:
- Standard size: `w-2 h-2 rounded-full`
- No glow effect

**3. `src/components/control-panel/control-panel-header.tsx`** - Local `getStatusDotColor()`:
- Running: `bg-green-500 animate-pulse`
- Unread: `bg-surface-400`
- Read: `bg-surface-500`
- **(Inconsistent with `thread-colors.ts`)**

**4. `src/index.css` - `.working-dot` class**:
- Uses `#22c55e` (green-500) with glow effect
- Custom `workingPulse` animation with `box-shadow` pulse
- This is the desired running animation style

**5. `src/components/workspace/threads-list.tsx`** - Uses Lucide icons with `animate-pulse`:
- Different approach (icons vs dots)
- Not relevant to this consolidation

## Problems to Solve

1. **Lost Legend**: Need to add legend back to the inbox footer
2. **Inconsistent Running Animation**: The glow effect in `.working-dot` is better than plain `animate-pulse`
3. **Inconsistent Colors**: `control-panel-header.tsx` uses different colors than `thread-colors.ts`
4. **No Reusable Component**: Dot styling is scattered as inline classes

## Implementation Plan

### Step 1: Create Reusable StatusDot Component

Create `src/components/ui/status-dot.tsx`:

```tsx
import { cn } from "@/lib/utils";

export type StatusDotVariant = "running" | "unread" | "read";

interface StatusDotProps {
  variant: StatusDotVariant;
  className?: string;
  /** Optional test ID for testing */
  "data-testid"?: string;
}

/**
 * Reusable status indicator dot.
 *
 * Variants:
 * - running: Green with glow animation
 * - unread: Accent color (no animation)
 * - read: Grey (no animation)
 */
export function StatusDot({ variant, className, ...props }: StatusDotProps) {
  return (
    <span
      className={cn(
        "w-2 h-2 rounded-full flex-shrink-0",
        variant === "running" && "status-dot-running",
        variant === "unread" && "bg-accent-500",
        variant === "read" && "bg-zinc-400",
        className
      )}
      {...props}
    />
  );
}
```

### Step 2: Update CSS for Running Animation

Add to `src/index.css` (replace the `.working-dot` class):

```css
/* Status dot - running state with glow animation */
.status-dot-running {
  background-color: #22c55e; /* green-500 */
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  animation: statusDotPulse 1.5s ease-in-out infinite;
}

@keyframes statusDotPulse {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  }
  50% {
    opacity: 0.6;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.3);
  }
}

/* Keep .working-dot as alias for backwards compatibility if needed */
.working-dot {
  @apply status-dot-running;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
```

### Step 3: Update `thread-colors.ts` to Use CSS Class

Modify `src/utils/thread-colors.ts`:

```tsx
export function getThreadDotColor(thread: ThreadMetadata): DotColorResult {
  if (thread.status === "running") {
    return { color: "status-dot-running" }; // CSS class handles animation
  }
  if (!thread.isRead) {
    return { color: "bg-accent-500" };
  }
  return { color: "bg-zinc-400" };
}

export function getPlanDotColor(isRead: boolean, hasRunningThread: boolean): DotColorResult {
  if (hasRunningThread) {
    return { color: "status-dot-running" };
  }
  if (!isRead) {
    return { color: "bg-accent-500" };
  }
  return { color: "bg-zinc-400" };
}
```

### Step 4: Create StatusLegend Component

Create `src/components/ui/status-legend.tsx`:

```tsx
import { StatusDot } from "./status-dot";

/**
 * Legend explaining status dot colors.
 * Designed for footer placement in inbox/list views.
 */
export function StatusLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-surface-500">
      <div className="flex items-center gap-1.5">
        <StatusDot variant="running" />
        <span>Running</span>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusDot variant="unread" />
        <span>Unread</span>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusDot variant="read" />
        <span>Read</span>
      </div>
    </div>
  );
}
```

### Step 5: Add Legend to Main Window Inbox

Update `src/components/main-window/main-window-layout.tsx`:

Add footer with `StatusLegend`:

```tsx
{activeTab === "inbox" && (
  <div className="flex flex-col h-full">
    <InboxHeader ... />
    <div className="flex-1 overflow-auto">
      <UnifiedInbox ... />
    </div>
    <footer className="px-4 py-2 border-t border-surface-700/50">
      <StatusLegend />
    </footer>
  </div>
)}
```

### Step 6: Update Inbox Item to Use StatusDot Component

Update `src/components/inbox/inbox-item.tsx`:

Replace inline dot rendering with:

```tsx
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";

// In useItemDotColor hook, change return type to variant:
function useItemDotVariant(item: InboxItem): StatusDotVariant {
  // ... logic returns "running" | "unread" | "read"
}

// In component:
const variant = useItemDotVariant(item);
<StatusDot variant={variant} data-testid="status-dot" />
```

### Step 7: Update Control Panel Header

Update `src/components/control-panel/control-panel-header.tsx`:

Replace local `getStatusDotColor()` with:

```tsx
import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";

function getStatusVariant(isStreaming: boolean, isRead?: boolean): StatusDotVariant {
  if (isStreaming) return "running";
  if (isRead === false) return "unread";
  return "read";
}

// In component:
<StatusDot variant={getStatusVariant(isStreaming, thread?.isRead)} />
```

### Step 8: Export from UI Index

Create or update `src/components/ui/index.ts`:

```tsx
export { StatusDot, type StatusDotVariant } from "./status-dot";
export { StatusLegend } from "./status-legend";
```

## File Changes Summary

| File | Action |
|------|--------|
| `src/components/ui/status-dot.tsx` | Create |
| `src/components/ui/status-legend.tsx` | Create |
| `src/components/ui/index.ts` | Create/Update |
| `src/index.css` | Modify (add CSS class) |
| `src/utils/thread-colors.ts` | Modify (use CSS class) |
| `src/components/inbox/inbox-item.tsx` | Modify (use component) |
| `src/components/control-panel/control-panel-header.tsx` | Modify (use component) |
| `src/components/main-window/main-window-layout.tsx` | Modify (add footer) |

## Testing

1. **Visual verification**:
   - Open main window inbox, verify legend appears in footer
   - Running items should show green dot with glow animation
   - Unread items should show accent color dot
   - Read items should show grey dot

2. **Animation consistency**:
   - Compare running animation in inbox list vs control panel header
   - Both should have identical glow effect

3. **Unit tests**:
   - Test `StatusDot` renders correct classes for each variant
   - Test `StatusLegend` renders all three legend items

## Migration Notes

- The `DotColorResult` type in `thread-colors.ts` can be simplified since animation is now handled by CSS
- Consider deprecating `animation` field in `DotColorResult` interface
- The `.working-dot` class in CSS can be kept as an alias for any other usages
