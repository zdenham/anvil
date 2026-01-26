import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { ListTodo, Check, Circle, Loader2 } from "lucide-react";
import type { ToolBlockProps } from "./index";

const LINE_COLLAPSE_THRESHOLD = 10;
const MAX_COLLAPSED_HEIGHT = 200;

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

interface TodoSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

function isValidStatus(status: unknown): status is TodoItem["status"] {
  return status === "pending" || status === "in_progress" || status === "completed";
}

function parseTodosInput(input: Record<string, unknown>): TodoItem[] {
  const todosRaw = input?.todos;
  if (!Array.isArray(todosRaw)) return [];

  return todosRaw.map((item) => ({
    content: typeof item?.content === "string" ? item.content : "",
    status: isValidStatus(item?.status) ? item.status : "pending",
    activeForm: typeof item?.activeForm === "string" ? item.activeForm : "",
  }));
}

function calculateSummary(todos: TodoItem[]): TodoSummary {
  return {
    total: todos.length,
    completed: todos.filter((t) => t.status === "completed").length,
    inProgress: todos.filter((t) => t.status === "in_progress").length,
    pending: todos.filter((t) => t.status === "pending").length,
  };
}

function TodoItemRow({ todo }: { todo: TodoItem }) {
  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      {todo.status === "completed" && (
        <Check className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
      )}
      {todo.status === "in_progress" && (
        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0 mt-0.5" />
      )}
      {todo.status === "pending" && (
        <Circle className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
      )}
      <span className="text-zinc-300 flex-1 min-w-0">{todo.content}</span>
      <span
        className={cn(
          "px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 border",
          todo.status === "completed" &&
            "bg-green-500/15 text-green-300 border-green-500/30",
          todo.status === "in_progress" &&
            "bg-blue-500/15 text-blue-300 border-blue-500/30",
          todo.status === "pending" &&
            "bg-zinc-700/30 text-zinc-400 border-zinc-600/50"
        )}
      >
        {todo.status === "in_progress" ? "in progress" : todo.status}
      </span>
    </div>
  );
}

/**
 * Specialized block for rendering TodoWrite tool calls.
 * Displays a formatted todo list with status icons and badges.
 */
export function TodoWriteToolBlock({
  id,
  input,
  status,
  durationMs,
  threadId,
}: ToolBlockProps) {
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const todos = parseTodosInput(input);
  const summary = calculateSummary(todos);
  const isRunning = status === "running";
  const isLongList = todos.length > LINE_COLLAPSE_THRESHOLD;

  const defaultOutputExpanded = !isLongList;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      ariaLabel={`TodoWrite: Update todos, status: ${status}`}
      testId={`todowrite-tool-${id}`}
      className="py-0.5"
      header={
        <div className="flex flex-col gap-0.5">
          {/* Line 1: Description with chevron and shimmer animation */}
          <div className="flex items-center gap-2">
            <ExpandChevron isExpanded={isExpanded} size="md" />
            <ShimmerText
              isShimmering={isRunning}
              className="text-sm text-zinc-200 truncate min-w-0"
            >
              Updating todos
            </ShimmerText>
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {formatDuration(durationMs)}
              </span>
            )}
          </div>
          {/* Line 2: Command/details with icon (icon ONLY on this line) */}
          <div className="flex items-center gap-1 mt-0.5">
            <ListTodo className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="text-xs text-zinc-400">
              {summary.total} items
              {summary.completed > 0 && ` · ${summary.completed} completed`}
              {summary.inProgress > 0 && ` · ${summary.inProgress} in progress`}
            </span>
          </div>
        </div>
      }
    >
      {/* Todo list */}
      {todos.length > 0 && (
        <div className="mt-2 ml-6">
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongList}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant="default"
          >
            <div className="p-2 space-y-1">
              {todos.map((todo, idx) => (
                <TodoItemRow key={idx} todo={todo} />
              ))}
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Empty state */}
      {todos.length === 0 && !isRunning && (
        <div className="mt-2 ml-6 text-xs text-zinc-500">No todo items</div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning ? "Updating todo list" : `Todo list updated: ${summary.total} items`}
      </span>
    </CollapsibleBlock>
  );
}
