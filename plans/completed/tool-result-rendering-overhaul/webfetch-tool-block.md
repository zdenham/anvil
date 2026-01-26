# WebFetch Tool Block Implementation Plan

## Overview

This document details the implementation of the **WebFetchToolBlock** component for rendering WebFetch tool results in the thread view.

The WebFetch tool allows Claude to fetch and parse content from URLs. This component will display:
- Header with status (Fetch URL / Fetching URL)
- Second line with the URL (truncated with full URL on hover)
- Expandable section with the AI response rendered as markdown

---

## Anthropic API Data Structures

The WebFetch tool follows the standard Anthropic tool use/result pattern. Reference the SDK types:

```typescript
// From @anthropic-ai/sdk/resources/messages
import type { ToolUseBlock, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

// ToolUseBlock shape (what Claude sends):
interface ToolUseBlock {
  type: "tool_use";
  id: string;           // Unique tool use ID (e.g., "toolu_01ABC...")
  name: string;         // "WebFetch"
  input: {
    url: string;        // The URL to fetch
    prompt: string;     // The prompt used to process the fetched content
  };
}

// ToolResultBlockParam shape (what we send back to Claude):
interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;  // Matches the ToolUseBlock.id
  content: string | ContentBlockParam[];  // The result content
  is_error?: boolean;   // True if the tool execution failed
}
```

**Important:** The `result` prop in `ToolBlockProps` is the string content from `ToolResultBlockParam.content`. For WebFetch, this is a JSON-stringified object containing the AI-processed response.

---

## Design Pattern

The WebFetchToolBlock follows the **BashToolBlock convention** established in the main plan. Key design decisions:

1. **Collapsible structure** - Closed by default, expands to show full response
2. **Two-line header** - Primary line (header) + Secondary line (URL)
3. **Visual consistency** - Uses all reusable UI components from `src/components/ui/`
4. **Responsive URL display** - Truncates long URLs while maintaining readability
5. **Markdown rendering** - AI response rendered as formatted markdown, never raw JSON

---

## Reusable UI Components

The WebFetchToolBlock uses these reusable components from `src/components/ui/`:

| Component | File | Purpose | Usage in WebFetchToolBlock |
|-----------|------|---------|----------------------------|
| **ExpandChevron** | `expand-chevron.tsx` | Animated chevron for collapse/expand state | Header row - toggles between ChevronRight and ChevronDown based on `isExpanded` state |
| **ShimmerText** | `shimmer-text.tsx` | Loading animation during fetch | Wraps "Fetching URL" text while `status === "running"` |
| **CopyButton** | `copy-button.tsx` | Copy-to-clipboard with checkmark feedback | Copy URL (header), copy response content (expanded section) |
| **CollapsibleOutputBlock** | `collapsible-output-block.tsx` | Long content with gradient overlay + expand/collapse | Wraps markdown response content; handles gradient fade and expand/collapse for long responses |
| **StatusIcon** | `status-icon.tsx` | Success/failure indicator | Shows red X icon when `isError === true` |

**Import from `lucide-react`:**
- **Link** - URL indicator icon (`w-4 h-4 text-zinc-500`) - appears ONLY on the second line (URL details line), NOT on the first line which has the chevron

---

## Component Structure

### First Line: Description (Always Visible)
```
[ExpandChevron] Fetch URL / Fetching URL    [Duration] [StatusIcon?]
```

- **ExpandChevron** - Uses `size="md"`, toggles based on `isExpanded` state. This is the ONLY clickable element for collapse/expand on this line.
- **ShimmerText** - Wraps description text ("Fetch URL" / "Fetching URL"); `isShimmering={status === "running"}` to show shimmer animation during fetch
- **Duration** - Right-justified, only shown when `durationMs` is defined and not running
- **StatusIcon** - Only shown when `isError === true` and not running
- **NO ICON on first line** - The chevron serves as the visual indicator; adding an icon would be redundant

### Second Line: URL Details (Always Visible)
```
[Link Icon] https://example.com/very/long/path/to/resource...    [CopyButton]
```

- **Link icon** - From lucide-react, `w-4 h-4 text-zinc-500`. The icon ONLY appears on this line (not the first line which has the chevron).
- **URL** - Truncated to ~60 chars with `...` if longer; full URL in `title` attribute for hover tooltip
- **CopyButton** - `text={url}`, `label="Copy URL"`, appears on group hover (not `alwaysVisible`)

### Expanded Content (When `isExpanded === true`)
```
[CopyButton - absolute positioned top-right]
[CollapsibleOutputBlock]
  [Markdown content of AI response]
[/CollapsibleOutputBlock]
```

- **CopyButton** - `text={content}`, `label="Copy response"`, positioned absolutely top-right with `z-10`
- **CollapsibleOutputBlock** - Wraps the markdown content with:
  - `isExpanded={isContentExpanded}` - separate state for content expand
  - `onToggle` - toggles content expand state
  - `isLongContent={contentLines > LINE_COLLAPSE_THRESHOLD}`
  - `maxCollapsedHeight={300}`
  - `variant={isError ? "error" : "default"}`
- **Markdown content** - Rendered with `react-markdown`, styled with Tailwind prose classes

---

## Props Interface

The component receives the standard `ToolBlockProps` from `src/components/thread/tool-blocks/index.ts`:

```typescript
// From src/components/thread/tool-blocks/index.ts
interface ToolBlockProps {
  /** Unique tool use ID - matches Anthropic.ToolUseBlock.id */
  id: string;
  /** Tool name - "WebFetch" */
  name: string;
  /** Tool input parameters - matches Anthropic.ToolUseBlock.input */
  input: Record<string, unknown>;
  /** Tool execution result - JSON-stringified from ToolResultBlockParam.content */
  result?: string;
  /** Whether the result was an error - matches ToolResultBlockParam.is_error */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus; // "pending" | "running" | "complete" | "error"
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}
```

### WebFetch Input Shape

Cast from `input` prop to access WebFetch-specific fields:

```typescript
interface WebFetchInput {
  url: string;    // The URL to fetch
  prompt: string; // The prompt used to process the fetched content
}
```

### WebFetch Result Shape

The `result` prop is a JSON-stringified string. Parse it to access:

```typescript
interface WebFetchResult {
  url: string;         // Original URL requested
  final_url?: string;  // Final URL after redirects (if different)
  content: string;     // The AI-processed markdown response
}
```

**Important:** The `content` field contains the AI's processed response in markdown format. This is what we render - never display raw JSON to users.

---

## Implementation

### File: `src/components/thread/tool-blocks/web-fetch-tool-block.tsx`

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { Link } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ToolBlockProps } from "./index";

interface WebFetchInput {
  url: string;
  prompt: string;
}

interface WebFetchResult {
  url: string;
  final_url?: string;
  content: string;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;
const URL_TRUNCATE_LENGTH = 60;

/**
 * Parse the WebFetch result JSON string.
 * Returns structured data or null if parsing fails.
 */
function parseWebFetchResult(result: string | undefined): WebFetchResult | null {
  if (!result) {
    return null;
  }

  try {
    const parsed = JSON.parse(result) as WebFetchResult;
    if (typeof parsed === "object" && parsed !== null && "content" in parsed) {
      return {
        url: parsed.url || "",
        final_url: parsed.final_url,
        content: parsed.content || "",
      };
    }
  } catch {
    // Not valid JSON - treat the raw string as content (fallback)
    return {
      url: "",
      content: result,
    };
  }

  return null;
}

/**
 * Truncate URL for display, preserving domain visibility.
 */
function truncateUrl(url: string, maxLength: number = URL_TRUNCATE_LENGTH): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + "...";
}

/**
 * Specialized block for rendering WebFetch tool calls.
 * Displays a URL with fetched content rendered as markdown.
 */
export function WebFetchToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
  threadId,
}: ToolBlockProps) {
  // Expand state persisted in Zustand store (survives virtualization remounts)
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Parse input
  const webFetchInput = input as unknown as WebFetchInput;
  const url = webFetchInput.url || "";

  // Parse result
  const parsedResult = parseWebFetchResult(result);
  const content = parsedResult?.content || "";
  const finalUrl = parsedResult?.final_url;

  // Derived state
  const isRunning = status === "running";
  const hasContent = content.length > 0;
  const contentLines = content.split("\n").length;
  const isLongContent = contentLines > LINE_COLLAPSE_THRESHOLD;

  // Separate expand state for output content (default collapsed if long)
  const defaultContentExpanded = !isLongContent;
  const isContentExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultContentExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsContentExpanded = (expanded: boolean) =>
    setOutputExpanded(threadId, id, expanded);

  const truncatedUrl = truncateUrl(url);
  const hasRedirect = finalUrl && finalUrl !== url;

  return (
    <div
      className="group py-0.5"
      aria-label={`Fetch URL: ${url}, status: ${status}`}
      data-testid={`webfetch-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable Header Region */}
      <div
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* First Line: Description with shimmer animation */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {isRunning ? "Fetching URL" : "Fetch URL"}
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Duration - right justified */}
          {durationMs !== undefined && !isRunning && (
            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {formatDuration(durationMs)}
            </span>
          )}
        </div>

        {/* Second Line: URL with icon (icon ONLY on this line) */}
        <div className="flex items-center gap-1 mt-0.5 ml-5">
          <Link className="w-4 h-4 text-zinc-500 shrink-0" />
          <span
            className="text-xs font-mono text-zinc-500 truncate"
            title={url}
          >
            {truncatedUrl}
          </span>
          <CopyButton text={url} label="Copy URL" />
        </div>

        {/* Redirect indicator if final URL differs */}
        {hasRedirect && (
          <div className="flex items-center gap-1 mt-0.5 ml-5 text-xs text-zinc-400">
            <span>Redirected to:</span>
            <span className="font-mono text-zinc-500" title={finalUrl}>
              {truncateUrl(finalUrl)}
            </span>
          </div>
        )}
      </div>

      {/* Expanded Content: Markdown Response */}
      {isExpanded && hasContent && (
        <div className="relative mt-2 ml-5">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={content} label="Copy response" />
          </div>
          <CollapsibleOutputBlock
            isExpanded={isContentExpanded}
            onToggle={() => setIsContentExpanded(!isContentExpanded)}
            isLongContent={isLongContent}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <div
              className={cn(
                "prose prose-invert prose-sm max-w-none",
                "p-3 text-zinc-300",
                isError && "text-red-200"
              )}
            >
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Expanded but no content yet (still running) */}
      {isExpanded && !hasContent && isRunning && (
        <div className="mt-2 ml-5">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Fetching content...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Expanded, completed, but errored with no content */}
      {isExpanded && !hasContent && !isRunning && isError && (
        <div className="mt-2 ml-5">
          <div className="text-xs p-2 rounded border border-red-500/30 text-red-200 bg-red-950/30">
            Failed to fetch URL
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Fetching URL"
          : isError
            ? "Fetch failed"
            : "URL fetched successfully"}
      </span>
    </div>
  );
}
```

---

## Registry Export

Update `src/components/thread/tool-blocks/index.ts` to register the WebFetchToolBlock:

```typescript
import { BashToolBlock } from "./bash-tool-block";
import { WebFetchToolBlock } from "./web-fetch-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  webfetch: WebFetchToolBlock,
};

export { BashToolBlock, WebFetchToolBlock };
```

**Note:** Registry keys are lowercase for case-insensitive matching in `getSpecializedToolBlock()`.

---

## Display Format Summary

| Data | Display Format | Never Display |
|------|----------------|---------------|
| **URL** | Truncated text with full URL on hover (title attribute) | - |
| **Redirect URL** | "Redirected to: [truncated URL]" below secondary line | - |
| **AI Response** | Rendered as markdown with Tailwind prose classes | Raw JSON |
| **Error Message** | Styled error box with "Failed to fetch URL" text | Raw error JSON |
| **Loading State** | "Fetching content..." with pulse animation | - |

**Key principle:** Users see human-readable formatted content. The `content` field from the result is always markdown - render it as such.

---

## Styling Classes

Consistent with BashToolBlock:

- **Container:** `group py-0.5` - enables group-hover for CopyButton
- **First line (description):** `flex items-center gap-2` - contains chevron and shimmer text, NO icon
- **Second line (URL details):** `flex items-center gap-1 mt-0.5 ml-5` - indented to align with description text, contains the Link icon
- **Icon:** `w-4 h-4 text-zinc-500` - ONLY appears on the second line (first line has chevron instead)
- **URL text:** `text-xs font-mono text-zinc-500`
- **Markdown content:** `prose prose-invert prose-sm max-w-none` - uses `@tailwindcss/typography`
- **Loading animation:** `animate-pulse` class on cursor element

---

## State Management

Uses `useToolExpandStore` from `@/stores/tool-expand-store` for:

1. **Tool expand state** (`isToolExpanded`, `setToolExpanded`) - Whether the tool block itself is expanded
2. **Output expand state** (`isOutputExpanded`, `setOutputExpanded`) - Whether the content section is fully expanded (for long content)

Both states persist across React virtualization remounts, ensuring consistent UX when scrolling through long thread views.

---

## Accessibility

- **Role:** `button` on clickable header with `role="button"`
- **Aria-expanded:** Reflects current expand state
- **Keyboard navigation:** Enter and Space keys toggle expand/collapse
- **Screen reader:** `sr-only` span announces status (running, failed, complete)
- **Semantic HTML:** Markdown rendered with proper heading hierarchy via `react-markdown`

---

## Dependencies

- `react-markdown` - For rendering markdown content (should already be in dependencies)
- `@tailwindcss/typography` - For prose styling (verify in `tailwind.config.js`)
- `lucide-react` - For Link icon

---

## Testing Considerations

1. **Unit tests:**
   - URL truncation at various lengths
   - Result JSON parsing (valid JSON, invalid JSON, plain string fallback)
   - Redirect indicator display when `final_url` differs from `url`
   - Expand/collapse state persistence via store
   - Keyboard navigation (Enter/Space)

2. **Visual tests:**
   - Long URLs (100+ chars)
   - Very long markdown responses (100+ lines)
   - Responses with code blocks, lists, headings
   - Error state styling
   - Running state with shimmer animation
   - CollapsibleOutputBlock gradient overlay

3. **Integration tests:**
   - Verify expand state survives virtualization remount
   - Test with actual WebFetch tool results from state.json
