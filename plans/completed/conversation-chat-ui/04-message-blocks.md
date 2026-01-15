# Message Blocks

Atomic components for rendering individual message content blocks within the conversation.

**Prerequisites:** `01-types-and-utilities.md`, `03-state-components.md`

## Files Owned

```
src/components/conversation/
├── text-block.tsx          # Streaming markdown content
├── thinking-block.tsx      # Collapsible agent reasoning
├── tool-use-block.tsx      # Collapsible tool execution card
├── file-change-block.tsx   # File operation notification
└── streaming-cursor.tsx    # Animated typing cursor
```

## Dependencies

```bash
pnpm add streamdown  # Vercel's streaming markdown library
```

## Implementation

### 1. Create text-block.tsx

Renders streaming markdown using [Streamdown](https://github.com/vercel/streamdown):

```typescript
// src/components/conversation/text-block.tsx
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

interface TextBlockProps {
  /** Markdown text content */
  content: string;
  /** Whether this block is still receiving content */
  isStreaming?: boolean;
  className?: string;
}

/**
 * Renders markdown text with streaming support.
 * Uses Streamdown for handling incomplete markdown during streaming.
 */
export function TextBlock({
  content,
  isStreaming = false,
  className,
}: TextBlockProps) {
  return (
    <div
      className={cn(
        "prose prose-invert prose-sm max-w-none",
        // Code block styling
        "prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800",
        "prose-code:text-amber-400 prose-code:before:content-none prose-code:after:content-none",
        // Link styling
        "prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline",
        className
      )}
    >
      <Streamdown>{content}</Streamdown>
      {isStreaming && <StreamingCursor />}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span
      className="inline-block w-2 h-5 ml-0.5 bg-current animate-pulse align-text-bottom"
      aria-hidden="true"
    />
  );
}
```

### 2. Create thinking-block.tsx

Collapsible display for agent thinking/reasoning:

```typescript
// src/components/conversation/thinking-block.tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  /** Thinking/reasoning content */
  content: string;
  /** Whether to show expanded by default */
  defaultExpanded?: boolean;
}

/**
 * Collapsible block for agent extended thinking.
 * Collapsed by default to reduce visual noise.
 */
export function ThinkingBlock({
  content,
  defaultExpanded = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Truncate preview to first 100 characters
  const preview =
    content.length > 100 ? content.slice(0, 100) + "..." : content;

  return (
    <details
      open={isExpanded}
      onToggle={(e) => setIsExpanded(e.currentTarget.open)}
      className="group"
      aria-label="Assistant reasoning"
    >
      <summary
        className={cn(
          "flex items-center gap-2 cursor-pointer select-none",
          "text-sm text-muted-foreground hover:text-foreground",
          "list-none [&::-webkit-details-marker]:hidden"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <Brain className="h-4 w-4 shrink-0 text-violet-400" aria-hidden="true" />
        <span className="font-medium">Thinking</span>
        {!isExpanded && (
          <span className="truncate opacity-60 italic">{preview}</span>
        )}
      </summary>

      <div
        role="region"
        aria-label="Thinking content"
        className={cn(
          "mt-2 pl-6 text-sm text-muted-foreground italic",
          "border-l-2 border-violet-400/30"
        )}
      >
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </details>
  );
}
```

### 3. Create tool-use-block.tsx

Collapsible tool execution visualization:

```typescript
// src/components/conversation/tool-use-block.tsx
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Terminal,
  Search,
  Globe,
  GitBranch,
  Wrench,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getToolDisplayName } from "@/lib/utils/tool-icons";
import { formatDuration } from "@/lib/utils/time-format";

interface ToolUseBlockProps {
  /** Unique tool use ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Tool execution result (if completed) */
  result?: string;
  /** Whether the result was an error */
  isError?: boolean;
  /** Current execution status */
  status: "running" | "complete" | "error";
  /** Execution duration in milliseconds */
  durationMs?: number;
}

// Tool name to icon mapping
const TOOL_ICONS: Record<string, typeof Wrench> = {
  read: FileText,
  write: Pencil,
  edit: Pencil,
  bash: Terminal,
  grep: Search,
  glob: Search,
  webfetch: Globe,
  websearch: Globe,
  task: GitBranch,
};

function getToolIconComponent(toolName: string) {
  const normalized = toolName.toLowerCase();
  for (const [pattern, Icon] of Object.entries(TOOL_ICONS)) {
    if (normalized.includes(pattern)) {
      return Icon;
    }
  }
  return Wrench;
}

/**
 * Collapsible card displaying tool execution details.
 */
export function ToolUseBlock({
  id,
  name,
  input,
  result,
  isError = false,
  status,
  durationMs,
}: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const Icon = getToolIconComponent(name);
  const displayName = getToolDisplayName(name);

  const inputStr = JSON.stringify(input, null, 2);
  const showInputTruncated = inputStr.length > 500;
  const truncatedInput = showInputTruncated
    ? inputStr.slice(0, 500) + "\n..."
    : inputStr;

  const showResultTruncated = result && result.length > 1000;
  const truncatedResult = showResultTruncated
    ? result.slice(0, 1000) + "\n..."
    : result;

  return (
    <details
      open={isExpanded}
      onToggle={(e) => setIsExpanded(e.currentTarget.open)}
      className={cn(
        "group rounded-lg border",
        status === "error" || isError
          ? "border-red-500/30 bg-red-950/20"
          : "border-zinc-700 bg-zinc-900/50"
      )}
      aria-label={`Tool: ${displayName}, status: ${status}`}
    >
      <summary
        className={cn(
          "flex items-center gap-2 p-3 cursor-pointer select-none",
          "list-none [&::-webkit-details-marker]:hidden",
          "hover:bg-zinc-800/50 rounded-lg transition-colors"
        )}
      >
        {/* Expand icon */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        {/* Tool icon */}
        <Icon className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />

        {/* Tool name */}
        <span className="font-medium text-sm">{displayName}</span>

        {/* Status indicator */}
        <span className="ml-auto flex items-center gap-2">
          {durationMs !== undefined && status !== "running" && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(durationMs)}
            </span>
          )}
          <StatusIcon status={status} isError={isError} />
        </span>

        {/* Screen reader status */}
        <span className="sr-only">
          {status === "running"
            ? "In progress"
            : isError
              ? "Failed"
              : "Completed"}
        </span>
      </summary>

      <div className="px-3 pb-3 space-y-3">
        {/* Input section */}
        <div role="region" aria-label="Tool input">
          <h4 className="text-xs font-medium text-muted-foreground mb-1">
            Input
          </h4>
          <pre className="text-xs bg-zinc-950 p-2 rounded overflow-x-auto">
            <code>{isExpanded ? inputStr : truncatedInput}</code>
          </pre>
          {showInputTruncated && !isExpanded && (
            <button
              className="text-xs text-blue-400 hover:underline mt-1"
              onClick={(e) => {
                e.preventDefault();
                setIsExpanded(true);
              }}
            >
              Show more
            </button>
          )}
        </div>

        {/* Output section */}
        {result !== undefined && (
          <div role="region" aria-label="Tool output">
            <h4 className="text-xs font-medium text-muted-foreground mb-1">
              Output
            </h4>
            <pre
              className={cn(
                "text-xs p-2 rounded overflow-x-auto max-h-64 overflow-y-auto",
                isError ? "bg-red-950/50 text-red-300" : "bg-zinc-950"
              )}
            >
              <code>{isExpanded ? result : truncatedResult}</code>
            </pre>
            {showResultTruncated && !isExpanded && (
              <button
                className="text-xs text-blue-400 hover:underline mt-1"
                onClick={(e) => {
                  e.preventDefault();
                  setIsExpanded(true);
                }}
              >
                Show more
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function StatusIcon({
  status,
  isError,
}: {
  status: "running" | "complete" | "error";
  isError: boolean;
}) {
  if (status === "running") {
    return (
      <Loader2 className="h-4 w-4 animate-spin text-blue-400" aria-hidden="true" />
    );
  }
  if (status === "error" || isError) {
    return <XCircle className="h-4 w-4 text-red-400" aria-hidden="true" />;
  }
  return <CheckCircle className="h-4 w-4 text-green-400" aria-hidden="true" />;
}
```

### 4. Create file-change-block.tsx

Compact notification for file operations:

```typescript
// src/components/conversation/file-change-block.tsx
import { FilePlus, FileEdit, FileMinus, FileSymlink, File } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileChangeMessage } from "@/lib/types/agent-messages";

interface FileChangeBlockProps {
  /** File path */
  path: string;
  /** Operation type */
  operation: FileChangeMessage["operation"];
  /** For renames, the original path */
  oldPath?: string;
  /** Callback when clicking to view diff */
  onClick?: (path: string) => void;
}

const OPERATION_CONFIG = {
  create: {
    icon: FilePlus,
    label: "Created",
    color: "text-green-400",
    bg: "bg-green-950/30",
    border: "border-green-500/30",
  },
  modify: {
    icon: FileEdit,
    label: "Modified",
    color: "text-blue-400",
    bg: "bg-blue-950/30",
    border: "border-blue-500/30",
  },
  delete: {
    icon: FileMinus,
    label: "Deleted",
    color: "text-red-400",
    bg: "bg-red-950/30",
    border: "border-red-500/30",
  },
  rename: {
    icon: FileSymlink,
    label: "Renamed",
    color: "text-yellow-400",
    bg: "bg-yellow-950/30",
    border: "border-yellow-500/30",
  },
};

/**
 * Compact file change notification.
 * Clicking navigates to the diff viewer tab.
 */
export function FileChangeBlock({
  path,
  operation,
  oldPath,
  onClick,
}: FileChangeBlockProps) {
  const config = OPERATION_CONFIG[operation] || {
    icon: File,
    label: "Changed",
    color: "text-muted-foreground",
    bg: "bg-zinc-900",
    border: "border-zinc-700",
  };

  const Icon = config.icon;

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  return (
    <button
      onClick={() => onClick?.(path)}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full text-left",
        "border transition-colors",
        config.bg,
        config.border,
        onClick && "hover:brightness-110 cursor-pointer"
      )}
      disabled={!onClick}
    >
      <Icon className={cn("h-4 w-4 shrink-0", config.color)} aria-hidden="true" />

      <span className="flex-1 min-w-0">
        {operation === "rename" && oldPath ? (
          <span className="flex flex-col gap-0.5">
            <span className="text-muted-foreground line-through truncate">
              {oldPath}
            </span>
            <span className={cn("truncate", config.color)}>{path}</span>
          </span>
        ) : (
          <span className="truncate block" title={path}>
            {filename}
          </span>
        )}
      </span>

      <span className={cn("text-xs font-medium", config.color)}>
        {config.label}
      </span>
    </button>
  );
}
```

### 5. Create streaming-cursor.tsx

Standalone animated cursor component:

```typescript
// src/components/conversation/streaming-cursor.tsx
import { cn } from "@/lib/utils";

interface StreamingCursorProps {
  className?: string;
}

/**
 * Animated blinking cursor shown at end of streaming text.
 */
export function StreamingCursor({ className }: StreamingCursorProps) {
  return (
    <>
      <span
        className={cn(
          "inline-block w-2 h-5 ml-0.5 bg-current align-text-bottom",
          "animate-pulse",
          className
        )}
        aria-hidden="true"
      />
      <span className="sr-only">Assistant is typing</span>
    </>
  );
}
```

## Tool State Derivation

Tool status is derived from message stream using `deriveToolStates` from `01-types-and-utilities.md`:

```typescript
// Import from utilities (defined in 01-types-and-utilities.md)
import { deriveToolStates, type ToolState } from "@/lib/utils/tool-state";
```

## Accessibility

### ToolUseBlock

```tsx
<details aria-label={`Tool: ${toolName}, status: ${status}`}>
  <summary>
    <span aria-hidden="true">{icon}</span>
    <span>{toolName}</span>
    <span className="sr-only">{status === "running" ? "In progress" : status}</span>
  </summary>
  <div role="region" aria-label="Tool input">...</div>
  <div role="region" aria-label="Tool output">...</div>
</details>
```

### Tool Execution Announcements

```tsx
<span role="status" aria-live="polite" className="sr-only">
  {status === "running" && `Running tool: ${toolName}`}
  {status === "complete" && `Tool ${toolName} completed`}
  {status === "error" && `Tool ${toolName} failed`}
</span>
```

## Checklist

- [ ] Install streamdown: `pnpm add streamdown`
- [ ] Create `src/components/conversation/text-block.tsx`
- [ ] Create `src/components/conversation/thinking-block.tsx`
- [ ] Create `src/components/conversation/tool-use-block.tsx`
- [ ] Create `src/components/conversation/file-change-block.tsx`
- [ ] Create `src/components/conversation/streaming-cursor.tsx`
- [ ] Test with various tool types and input sizes
- [ ] Test collapse/expand behavior
- [ ] Verify accessibility with screen readers

**Note:** `tool-state.ts` is defined in `01-types-and-utilities.md`.
