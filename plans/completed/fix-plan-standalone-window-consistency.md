# Fix Plan Standalone Window Consistency

## Problem

The plan mode standalone window has different behavior than the thread standalone window:

1. **Dragging behavior differs** - Plan windows use the same drag logic as NSPanel (custom drag via `useWindowDrag`), while thread windows correctly disable custom dragging for standalone windows and rely on native `setMovableByWindowBackground(true)`.

2. **Header overlap with native traffic lights** - Plan windows don't account for the overlay title bar padding, causing the header content to overlap with the native close/minimize/fullscreen buttons.

3. **Missing standalone window props** - `PlanView` doesn't receive or use `isStandaloneWindow` or `instanceId` props, so it can't differentiate its behavior.

## Root Cause Analysis

### Thread Window (Correct Implementation)

In `ControlPanelWindow.tsx`, when rendering the thread view via `ControlPanelWindowContent`:
- Receives `isStandaloneWindow` and `instanceId` props
- Conditionally applies padding for traffic lights: `isStandaloneWindow && "pt-7"`
- Disables custom drag for standalone windows: `!isStandaloneWindow && dragProps.className`
- Doesn't call `useWindowDrag` handlers for standalone windows

The backend `create_control_panel_window()` in `panels.rs` sets:
- `decorations(true)` - native window decorations
- `title_bar_style(TitleBarStyle::Overlay)` - hides title, keeps traffic lights
- `setMovableByWindowBackground(true)` - native drag from background

### Plan Window (Broken Implementation)

In `ControlPanelWindow.tsx` line 67-68:
```typescript
if (view.type === "plan") {
  return <PlanView planId={view.planId} />;
}
```

The `PlanView` component:
- Does NOT receive `isStandaloneWindow` or `instanceId` props
- Always uses `useWindowDrag()` without standalone-aware options
- Always applies drag handlers regardless of window type
- Missing padding for traffic light buttons

The backend `create_control_panel_window_plan()` correctly sets native decorations, but the frontend doesn't adapt.

## Solution

### 1. Pass standalone window props to PlanView

Update `ControlPanelWindow.tsx` to pass the props:

```typescript
if (view.type === "plan") {
  return (
    <PlanView
      planId={view.planId}
      isStandaloneWindow={params.isStandaloneWindow}
      instanceId={params.instanceId}
    />
  );
}
```

### 2. Update PlanView to handle standalone windows

Modify `PlanView.tsx`:

```typescript
interface PlanViewProps {
  planId: string;
  isStandaloneWindow?: boolean;
  instanceId?: string | null;
}

export function PlanView({ planId, isStandaloneWindow = false, instanceId }: PlanViewProps) {
  // ...

  // Window drag behavior - only use custom drag for NSPanel
  const { dragProps } = useWindowDrag({
    pinCommand: isStandaloneWindow ? undefined : "pin_control_panel",
    hideCommand: isStandaloneWindow ? undefined : "hide_control_panel",
    enableDoubleClickClose: !isStandaloneWindow,
  });

  // ...

  return (
    <div
      className={cn(
        "control-panel-container flex flex-col h-screen text-surface-50 relative overflow-hidden",
        // For NSPanel, use custom drag behavior. For standalone windows, use native behavior.
        !isStandaloneWindow && dragProps.className,
        // Standalone windows have native decorations, add padding for title bar
        isStandaloneWindow && "pt-7"
      )}
      onMouseDown={!isStandaloneWindow ? dragProps.onMouseDown : undefined}
      onDoubleClick={!isStandaloneWindow ? dragProps.onDoubleClick : undefined}
    >
      {/* ... */}
    </div>
  );
}
```

### 3. Update ControlPanelHeader for plan standalone windows

The `ControlPanelHeader` already receives `isStandaloneWindow` prop and conditionally hides close/pop-out buttons. Verify this works correctly when `PlanView` passes the prop through.

### 4. Handle Escape key in plan standalone windows

Update the keyboard handler in `PlanView` to close standalone windows properly:

```typescript
} else if (e.key === "Escape") {
  e.preventDefault();
  if (isStandaloneWindow && instanceId) {
    invoke("close_control_panel_window", { instanceId });
  } else {
    invoke("hide_control_panel");
  }
}
```

## Implementation Steps

1. Update `PlanViewProps` interface to include `isStandaloneWindow` and `instanceId`
2. Update `PlanView` component to:
   - Accept the new props with defaults
   - Configure `useWindowDrag` hook conditionally
   - Apply conditional container classes (`pt-7`, drag class)
   - Apply conditional event handlers
   - Handle Escape key for standalone windows
3. Update `ControlPanelWindow.tsx` to pass standalone props to `PlanView`
4. Pass `isStandaloneWindow` and `instanceId` to `ControlPanelHeader` from `PlanView`

## Testing Checklist

- [ ] NSPanel plan view: dragging works from anywhere when unfocused, header only when focused
- [ ] NSPanel plan view: double-click closes panel
- [ ] NSPanel plan view: Escape closes panel
- [ ] Standalone plan window: native drag works (drag from background/title area)
- [ ] Standalone plan window: no overlap with traffic light buttons
- [ ] Standalone plan window: Escape closes window
- [ ] Standalone plan window: close button hidden (uses native traffic lights)
- [ ] Standalone plan window: pop-out button hidden (already popped out)
- [ ] Thread standalone window: behavior unchanged (regression test)
