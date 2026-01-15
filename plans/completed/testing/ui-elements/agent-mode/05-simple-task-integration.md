# Sub-Plan 05: SimpleTask Integration

## Overview
Integrate the ModeIndicator into SimpleTaskHeader and wire up mode state to the SimpleTaskWindow.

## Dependencies
- **02-entity-types-and-store.md** - Requires store
- **03-ui-components.md** - Requires ModeIndicator component

## Can Run In Parallel With
- **06-thread-input-integration.md** - Can run in parallel after dependencies are met

## Scope
- Update SimpleTaskHeader to display ModeIndicator
- Update SimpleTaskWindow to pass threadId to header

## Files Involved

### Modified Files
| File | Change |
|------|--------|
| `src/components/simple-task/simple-task-header.tsx` | Add ModeIndicator, accept threadId prop |
| `src/components/simple-task/simple-task-window.tsx` | Pass threadId to header |

### Test Files
| File | Lines |
|------|-------|
| `src/components/simple-task/simple-task-header.ui.test.tsx` | ~60 |

## Implementation Details

### Step 1: Update SimpleTaskHeader

**File:** `src/components/simple-task/simple-task-header.tsx`

Update props interface:
```typescript
interface SimpleTaskHeaderProps {
  taskId: string;
  threadId: string;  // NEW
  status: "idle" | "loading" | "running" | "completed" | "error";
}
```

Import and integrate:
```typescript
import { ModeIndicator } from "./mode-indicator";
import { useAgentModeStore } from "@/entities/agent-mode";
import { DeleteButton } from "@/components/tasks/delete-button";

export function SimpleTaskHeader({ taskId, threadId, status }: SimpleTaskHeaderProps) {
  const currentMode = useAgentModeStore((s) => s.getMode(threadId));
  const cycleMode = useAgentModeStore((s) => s.cycleMode);

  const handleToggle = () => {
    cycleMode(threadId);
  };

  const handleDelete = async () => {
    await taskService.delete(taskId);
    await getCurrentWindow().close();
  };

  const isStreaming = status === "running";

  return (
    <div className="group flex items-center gap-3 px-4 py-3 bg-surface-800 border-b border-surface-700 [-webkit-app-region:drag]">
      <span className="font-mono text-xs text-surface-400">{taskId.slice(0, 8)}...</span>
      <span className={cn("text-[11px] font-medium uppercase px-2 py-0.5 rounded", statusStyles[status])}>
        {status}
      </span>
      <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
        <ModeIndicator
          mode={currentMode}
          onClick={handleToggle}
          disabled={isStreaming}
        />
        <DeleteButton onDelete={handleDelete} />
      </div>
    </div>
  );
}
```

> **Note:** The existing header structure includes a DeleteButton in the right section. The proposed JSX above preserves this by placing the ModeIndicator alongside the DeleteButton in the `ml-auto` container.

### Step 2: Update SimpleTaskWindow

**File:** `src/components/simple-task/simple-task-window.tsx`

Pass threadId to header (around line 94):
```typescript
<SimpleTaskHeader taskId={taskId} threadId={threadId} status={viewStatus} />
```

## Tests Required

### simple-task-header.ui.test.tsx
- Test mode indicator is displayed
- Test clicking indicator cycles through modes
- Test indicator is disabled when status is "running"
- Test mode persists per thread

```typescript
describe("SimpleTaskHeader", () => {
  it("displays the mode indicator", () => {
    render(<SimpleTaskHeader taskId="task-123" threadId="thread-456" status="idle" />);
    expect(screen.getByTestId("mode-indicator")).toBeInTheDocument();
  });

  it("toggles mode through all states", () => {
    render(<SimpleTaskHeader taskId="task-123" threadId="thread-456" status="idle" />);
    const indicator = screen.getByTestId("mode-indicator");

    expect(indicator).toHaveAttribute("data-mode", "normal");
    fireEvent.click(indicator);
    expect(indicator).toHaveAttribute("data-mode", "plan");
    fireEvent.click(indicator);
    expect(indicator).toHaveAttribute("data-mode", "auto-accept");
    fireEvent.click(indicator);
    expect(indicator).toHaveAttribute("data-mode", "normal");
  });

  it("disables indicator when status is running", () => {
    render(<SimpleTaskHeader taskId="task-123" threadId="thread-456" status="running" />);
    expect(screen.getByTestId("mode-indicator")).toBeDisabled();
  });
});
```

## Verification
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test:ui src/components/simple-task/simple-task-header` passes
- [ ] Mode indicator visible in SimpleTaskWindow header
- [ ] Clicking indicator cycles modes

## Estimated Time
~30 minutes
