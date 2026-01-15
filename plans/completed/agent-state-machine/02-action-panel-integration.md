# 02 - Action Panel Integration

## Changes to `src/components/workspace/action-panel.tsx`

### Updated Props Interface

```typescript
interface ActionPanelProps {
  taskId: string | null;
  threadId: string | null;
  onProgressToNextStep: (nextAgentType: string, defaultMessage: string) => void;
  onStayAndResume: (message: string) => void;
  onTaskComplete: () => void;
  onCancel?: () => void;
}
```

### Updated ActionContent Component

```typescript
import { useTaskStore } from "@/entities/tasks/store";
import { taskService } from "@/entities/tasks/service";
import {
  determineResponseAction,
  getNextPhaseLabel,
  getCurrentPhaseLabel,
} from "@/lib/agent-state-machine";
import type { PendingReview, TaskStatus } from "@/entities/tasks/types";

interface ActionContentProps {
  state: ActionState;
  taskId: string | null;
  pendingReview: PendingReview | null;
  taskStatus: TaskStatus;
  onProgressToNextStep: (nextAgentType: string, defaultMessage: string) => void;
  onStayAndResume: (message: string) => void;
  onTaskComplete: () => void;
  onCancel?: () => void;
}

function ActionContent({
  state,
  taskId,
  pendingReview,
  taskStatus,
  onProgressToNextStep,
  onStayAndResume,
  onTaskComplete,
  onCancel,
}: ActionContentProps) {
  const [inputValue, setInputValue] = useState("");

  const handleReviewSubmit = useCallback(async () => {
    if (!taskId || !pendingReview) return;

    const action = determineResponseAction(taskStatus, inputValue);

    // Clear pending review first
    await taskService.update(taskId, { pendingReview: null });

    switch (action.type) {
      case "progress":
        await taskService.update(taskId, { status: action.nextStatus });
        onProgressToNextStep(action.agentType, pendingReview.defaultResponse);
        break;

      case "complete":
        await taskService.update(taskId, { status: action.nextStatus });
        onTaskComplete();
        break;

      case "stay":
        onStayAndResume(action.message);
        break;
    }

    setInputValue("");
  }, [
    taskId,
    inputValue,
    pendingReview,
    taskStatus,
    onProgressToNextStep,
    onStayAndResume,
    onTaskComplete,
  ]);

  // ... rest of component
}
```

### Updated Main Component

```typescript
export function ActionPanel({
  taskId,
  threadId,
  onProgressToNextStep,
  onStayAndResume,
  onTaskComplete,
  onCancel,
}: ActionPanelProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const actionState = useActionState(taskId, threadId);

  const task = useTaskStore((state) =>
    taskId ? state.tasks[taskId] : null
  );

  const pendingReview = task?.pendingReview ?? null;
  const taskStatus = task?.status ?? "draft";

  // ... height handling

  return (
    <div className="relative border-t ..." style={{ height }}>
      <DragHandle position="top" onHeightChange={handleHeightChange} />
      <div className="h-full flex flex-col p-3">
        <ActionContent
          state={actionState}
          taskId={taskId}
          pendingReview={pendingReview}
          taskStatus={taskStatus}
          onProgressToNextStep={onProgressToNextStep}
          onStayAndResume={onStayAndResume}
          onTaskComplete={onTaskComplete}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
```

### Updated Review UI with Next Action Indicator

```typescript
{pendingReview && (
  <div className="flex flex-col h-full gap-3 overflow-hidden">
    {/* Header */}
    <div className="flex items-start gap-2 text-amber-400 mb-2">
      <MessageSquare size={16} className="mt-0.5 flex-shrink-0" />
      <span className="text-sm font-medium">Review Requested</span>
    </div>

    {/* Hint about what Enter does */}
    <div className="text-xs text-slate-400 mb-2">
      Press Enter to{" "}
      {taskStatus === "completed" ? (
        <span className="text-green-400">mark task complete</span>
      ) : (
        <span className="text-blue-400">
          proceed to {getNextPhaseLabel(taskStatus)}
        </span>
      )}
      , or type feedback to request changes.
    </div>

    {/* Markdown content */}
    <div className="flex-1 overflow-auto min-h-0">
      <div className="prose prose-invert prose-sm max-w-none ...">
        <Streamdown>{pendingReview.markdown}</Streamdown>
      </div>
    </div>

    {/* Input and submit */}
    <div className="flex gap-2 flex-shrink-0">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleReviewKeyDown}
        placeholder={pendingReview.defaultResponse}
        className="flex-1 px-3 py-2 rounded-lg bg-slate-800 ..."
        autoFocus
      />
      <button
        type="button"
        onClick={handleReviewSubmit}
        className={cn(
          "px-4 py-2 rounded-lg text-white transition-colors flex items-center gap-2 text-sm",
          inputValue.trim()
            ? "bg-amber-600 hover:bg-amber-500"
            : taskStatus === "completed"
              ? "bg-green-600 hover:bg-green-500"
              : "bg-blue-600 hover:bg-blue-500"
        )}
      >
        <Send className="h-4 w-4" />
        {inputValue.trim() ? (
          "Send Feedback"
        ) : taskStatus === "completed" ? (
          "Complete"
        ) : (
          "Proceed"
        )}
      </button>
    </div>
  </div>
)}
```

### Phase Indicator (Optional)

Show current phase in the header or action panel:

```typescript
function PhaseIndicator({ status }: { status: TaskStatus }) {
  const phases = [
    { status: "draft", label: "Plan" },
    { status: "in_progress", label: "Build" },
    { status: "completed", label: "Review" },
  ];

  const currentIndex = phases.findIndex((p) => p.status === status);

  return (
    <div className="flex items-center gap-1 text-xs">
      {phases.map((phase, i) => (
        <React.Fragment key={phase.status}>
          <span
            className={cn(
              "px-2 py-0.5 rounded",
              i < currentIndex
                ? "bg-green-600/20 text-green-400"
                : i === currentIndex
                  ? "bg-blue-600/20 text-blue-400"
                  : "bg-slate-700 text-slate-500"
            )}
          >
            {phase.label}
          </span>
          {i < phases.length - 1 && (
            <span className="text-slate-600">→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
```
