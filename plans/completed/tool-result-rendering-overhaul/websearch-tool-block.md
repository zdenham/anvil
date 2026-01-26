# WebSearchToolBlock Implementation Plan

## Overview

This document outlines the detailed implementation plan for `WebSearchToolBlock`, a specialized component for rendering web search results in the thread view. This component follows the established patterns from the BashToolBlock pilot and uses reusable UI components extracted in Phase 1.5.

**Important:** Web search uses Anthropic's server-side tool execution. The API returns a `ServerToolUseBlock` (type `server_tool_use`) for the tool invocation and a `WebSearchToolResultBlock` (type `web_search_tool_result`) for results, which differs from standard client-side `ToolUseBlock`/`ToolResultBlockParam` patterns.

---

## High-Level Design

The WebSearchToolBlock renders search results from the WebSearch tool in a clean, card-based format following the BashToolBlock conventions:

**First line (description):** ExpandChevron + "Web search" text with ShimmerText animation during running state + status indicators (error icon, result count, duration). The chevron controls expand/collapse of the entire block. No tool-specific icon on this line since the chevron occupies that visual position.

**Second line (command/details):** Globe icon + query text + CopyButton. The Globe icon appears here to identify the tool type, since the first line uses the chevron for expand/collapse control.

**Expanded content:** Search result cards rendered from `WebSearchResultBlock[]` with title, URL, page age, and encrypted content indicator

---

## Anthropic API Type Definitions

The component must handle the following Anthropic SDK types from `@anthropic-ai/sdk`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Server-side tool use block for web search invocation.
 * This is what Claude emits when initiating a web search.
 */
type ServerToolUseBlock = Anthropic.ServerToolUseBlock;
// Shape: { id: string; input: unknown; name: 'web_search'; type: 'server_tool_use' }

/**
 * Web search result block returned by Anthropic's servers.
 * This contains the actual search results.
 */
type WebSearchToolResultBlock = Anthropic.WebSearchToolResultBlock;
// Shape: { content: WebSearchToolResultBlockContent; tool_use_id: string; type: 'web_search_tool_result' }

/**
 * Content can be either an error or an array of search results.
 */
type WebSearchToolResultBlockContent = Anthropic.WebSearchToolResultBlockContent;
// Shape: WebSearchToolResultError | Array<WebSearchResultBlock>

/**
 * Individual search result with encrypted content.
 */
type WebSearchResultBlock = Anthropic.WebSearchResultBlock;
// Shape: { encrypted_content: string; page_age: string | null; title: string; type: 'web_search_result'; url: string }

/**
 * Error response when web search fails.
 */
type WebSearchToolResultError = Anthropic.WebSearchToolResultError;
// Shape: { error_code: 'invalid_tool_input' | 'unavailable' | 'max_uses_exceeded' | 'too_many_requests' | 'query_too_long'; type: 'web_search_tool_result_error' }

/**
 * The input shape for web search tool use.
 * Note: The SDK types this as `unknown`, but based on WebSearchTool20250305 config, it accepts:
 */
interface WebSearchInput {
  query: string;
  allowed_domains?: string[] | null;
  blocked_domains?: string[] | null;
}
```

---

## Component Structure

### Props Interface

The component receives the standard `ToolBlockProps` but handles web search-specific data:

```typescript
import type { ToolBlockProps } from "./index";

// Standard props from tool block registry:
interface ToolBlockProps {
  id: string;                        // Tool use ID (matches tool_use_id in result)
  name: string;                      // "web_search"
  input: Record<string, unknown>;    // WebSearchInput shape
  result?: string;                   // JSON-stringified WebSearchToolResultBlock.content
  isError?: boolean;                 // True if result was an error
  status: ToolStatus;                // "pending" | "running" | "complete"
  durationMs?: number;               // Execution time
  isFocused?: boolean;               // Keyboard navigation focus
  threadId: string;                  // For expand state persistence
}
```

---

## File Structure

**Location:** `/src/components/thread/tool-blocks/web-search-tool-block.tsx`

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { CopyButton } from "@/components/ui/copy-button";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { StatusIcon } from "@/components/ui/status-icon";
import { Globe, ExternalLink } from "lucide-react";
import type { ToolBlockProps } from "./index";

export function WebSearchToolBlock({ ... }: ToolBlockProps) {
  // Implementation here
}
```

**Registry Update:** `/src/components/thread/tool-blocks/index.ts`

```typescript
import { WebSearchToolBlock } from "./web-search-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  web_search: WebSearchToolBlock,  // Add this entry
};
```

---

## Implementation Details

### 1. Parse Result Function

Parse the JSON-stringified `WebSearchToolResultBlockContent` into a typed structure:

```typescript
import type Anthropic from "@anthropic-ai/sdk";

type WebSearchResultBlock = Anthropic.WebSearchResultBlock;

interface ParsedWebSearchResult {
  results: WebSearchResultBlock[];
  hasError: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Parse the result string which contains JSON-stringified WebSearchToolResultBlockContent.
 * Handles both success (array of WebSearchResultBlock) and error (WebSearchToolResultError) cases.
 */
function parseWebSearchResult(result: string | undefined, isError?: boolean): ParsedWebSearchResult {
  if (!result) {
    return { results: [], hasError: false };
  }

  try {
    const parsed = JSON.parse(result);

    // Check if it's an error response
    if (parsed?.type === "web_search_tool_result_error") {
      return {
        results: [],
        hasError: true,
        errorCode: parsed.error_code,
        errorMessage: getErrorMessage(parsed.error_code),
      };
    }

    // Check if it's an array of results
    if (Array.isArray(parsed)) {
      const validResults = parsed.filter(
        (item): item is WebSearchResultBlock =>
          item?.type === "web_search_result" &&
          typeof item.title === "string" &&
          typeof item.url === "string"
      );
      return { results: validResults, hasError: false };
    }
  } catch {
    // JSON parse failed
  }

  return {
    results: [],
    hasError: true,
    errorMessage: "Failed to parse search results",
  };
}

/**
 * Map error codes to user-friendly messages.
 */
function getErrorMessage(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    invalid_tool_input: "Invalid search query",
    unavailable: "Web search is temporarily unavailable",
    max_uses_exceeded: "Search limit exceeded",
    too_many_requests: "Too many search requests",
    query_too_long: "Search query is too long",
  };
  return errorMessages[errorCode] || `Search failed: ${errorCode}`;
}
```

### 2. Main Component Structure

Following the BashToolBlock pattern with reusable UI components:

```typescript
const RESULT_COLLAPSE_THRESHOLD = 5; // Number of results before offering collapse
const MAX_COLLAPSED_HEIGHT = 400;    // Max height when collapsed (pixels)

export function WebSearchToolBlock({
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
  // 1. Parse input and result
  const webSearchInput = input as unknown as WebSearchInput;
  const query = webSearchInput.query || "";
  const { results, hasError, errorCode, errorMessage } = parseWebSearchResult(result, isError);

  // 2. Use expand state store (persists across virtualization remounts)
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // 3. Use output expand state for long result lists
  const isLongOutput = results.length > RESULT_COLLAPSE_THRESHOLD;
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  // 4. Compute state
  const isRunning = status === "running";
  const hasResults = results.length > 0;
  const showError = hasError || isError;

  // 5. Render using reusable components
  return (
    <div
      className="group py-0.5"
      aria-label={`Web search: ${query}, status: ${status}`}
      data-testid={`web-search-tool-${id}`}
      data-tool-status={status}
    >
      {/* Collapsed/Summary Row - Clickable header */}
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
        {/* First line: chevron + description text (with shimmer) + status indicators */}
        {/* Note: No icon on this line - the chevron occupies the left position */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200"
          >
            Web search
          </ShimmerText>

          {/* Error indicator - only show on failure */}
          {!isRunning && showError && (
            <StatusIcon isSuccess={false} size="sm" />
          )}

          {/* Duration and result count - right justified */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {!isRunning && hasResults && (
              <span className="text-xs text-zinc-500">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            )}
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </div>

        {/* Second line: icon + query text (command/details) */}
        {/* The Globe icon appears here since first line has the chevron */}
        {query && (
          <div className="flex items-center gap-1.5 mt-0.5 pl-5">
            <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
              <span className="truncate">{query}</span>
            </code>
            <CopyButton text={query} label="Copy query" alwaysVisible />
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="relative mt-2">
          {/* Error state */}
          {showError && !hasResults && (
            <div className="text-xs text-red-400 p-2 rounded border border-red-500/30 bg-red-950/20">
              {errorMessage || "Search failed"}
              {errorCode && (
                <span className="text-red-500/70 ml-1">({errorCode})</span>
              )}
            </div>
          )}

          {/* Results list wrapped in CollapsibleOutputBlock for long lists */}
          {hasResults && (
            <CollapsibleOutputBlock
              isExpanded={isOutputExpanded}
              onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
              isLongContent={isLongOutput}
              maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
              variant="default"
            >
              <div className="space-y-2 p-2">
                {results.map((searchResult, index) => (
                  <SearchResultCard
                    key={`${searchResult.url}-${index}`}
                    result={searchResult}
                  />
                ))}
              </div>
            </CollapsibleOutputBlock>
          )}

          {/* Running state with no results yet */}
          {isRunning && !hasResults && (
            <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
              Searching the web...
              <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
            </div>
          )}

          {/* Completed but no results */}
          {!isRunning && !hasResults && !showError && (
            <div className="text-xs text-zinc-500 italic p-2">
              No results found
            </div>
          )}
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Web search running"
          : showError
            ? "Web search failed"
            : hasResults
              ? `Web search complete, ${results.length} results`
              : "Web search completed with no results"}
      </span>
    </div>
  );
}
```

### 3. SearchResultCard Sub-Component

Renders individual `WebSearchResultBlock` items in a user-friendly card format (no raw JSON):

```typescript
import type Anthropic from "@anthropic-ai/sdk";

interface SearchResultCardProps {
  result: Anthropic.WebSearchResultBlock;
}

/**
 * Renders a single web search result as a clean card.
 * Displays title (as link), domain, page age, and indicates content availability.
 *
 * Note: `encrypted_content` is not displayed directly as it contains encrypted data
 * that Claude uses internally. We indicate content is available without showing raw data.
 */
function SearchResultCard({ result }: SearchResultCardProps) {
  const { title, url, page_age, encrypted_content } = result;

  // Extract domain from URL for display
  const domain = extractDomain(url);

  // Format page age for display (e.g., "2 days ago", "1 week ago")
  const formattedAge = page_age ? formatPageAge(page_age) : null;

  // Indicate if content was retrieved (encrypted_content is non-empty)
  const hasContent = encrypted_content && encrypted_content.length > 0;

  return (
    <div className="border border-zinc-700/50 rounded px-3 py-2 hover:border-zinc-600/70 transition-colors">
      {/* Title as link */}
      <div className="flex items-start gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-400 hover:text-blue-300 hover:underline flex-1 min-w-0 break-words font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {title || url}
        </a>
        <ExternalLink className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" />
      </div>

      {/* Domain + page age + copy button */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-zinc-500 truncate">{domain}</span>
        {formattedAge && (
          <>
            <span className="text-xs text-zinc-600">·</span>
            <span className="text-xs text-zinc-500">{formattedAge}</span>
          </>
        )}
        <CopyButton text={url} label="Copy URL" />
      </div>

      {/* Content indicator */}
      {hasContent && (
        <div className="text-xs text-zinc-600 mt-1.5 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
          Content retrieved
        </div>
      )}
    </div>
  );
}
```

### 4. Utility Functions

```typescript
/**
 * Extract domain from URL for cleaner display.
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Format page_age string into human-readable format.
 * The API returns ISO 8601 date strings or relative strings.
 */
function formatPageAge(pageAge: string): string {
  // If it's already a relative string, return as-is
  if (pageAge.includes("ago") || pageAge.includes("day") || pageAge.includes("week")) {
    return pageAge;
  }

  // Try to parse as date and format relative
  try {
    const date = new Date(pageAge);
    if (isNaN(date.getTime())) return pageAge;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${diffDays >= 14 ? "s" : ""} ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${diffDays >= 60 ? "s" : ""} ago`;
    return `${Math.floor(diffDays / 365)} year${diffDays >= 730 ? "s" : ""} ago`;
  } catch {
    return pageAge;
  }
}
```

---

## Reusable UI Components Reference

The following components from `@/components/ui/` are used to ensure consistent design:

### 1. ExpandChevron
**Import:** `@/components/ui/expand-chevron`
**Usage:** First line - controls expand/collapse of the entire block
```typescript
<ExpandChevron isExpanded={isExpanded} size="md" />
```
**Props:** `isExpanded: boolean`, `size: "sm" | "md"`, `className?: string`

### 2. ShimmerText
**Import:** `@/components/ui/shimmer-text`
**Usage:** First line - description text with shimmer animation during running state
```typescript
<ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200">
  Web search
</ShimmerText>
```
**Props:** `isShimmering: boolean`, `className?: string`, `as?: "span" | "div" | "p"`, `children`

### 3. CopyButton
**Import:** `@/components/ui/copy-button`
**Usage:** Second line - copy query to clipboard; also used in result cards for URLs
```typescript
<CopyButton text={query} label="Copy query" alwaysVisible />
<CopyButton text={url} label="Copy URL" />
```
**Props:** `text: string`, `label?: string`, `alwaysVisible?: boolean`, `className?: string`

### 4. StatusIcon
**Import:** `@/components/ui/status-icon`
**Usage:** First line - error indicator after description text when search fails
```typescript
<StatusIcon isSuccess={false} size="sm" />
```
**Props:** `isSuccess: boolean`, `size?: "sm" | "md" | "lg"`, `className?: string`

### 5. CollapsibleOutputBlock
**Import:** `@/components/ui/collapsible-output-block`
**Usage:** Wrap search results list for long result sets with gradient fade and expand button
```typescript
<CollapsibleOutputBlock
  isExpanded={isOutputExpanded}
  onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
  isLongContent={isLongOutput}
  maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
  variant="default"
>
  {/* Search result cards */}
</CollapsibleOutputBlock>
```
**Props:** `isExpanded: boolean`, `onToggle: () => void`, `isLongContent: boolean`, `maxCollapsedHeight?: number`, `variant?: "default" | "error"`, `className?: string`, `children`

---

## State Management

Uses the Zustand store pattern from BashToolBlock for consistent behavior:

```typescript
// Tool block expand state (header collapse/expand)
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Output expand state (for long result lists)
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);
```

This persists expand/collapse state across virtualization remounts.

---

## Display Format (No Raw JSON)

The component ensures no raw JSON is displayed to users:

| Data Field | Display Format |
|------------|---------------|
| `results[]` | Rendered as styled SearchResultCard components |
| `title` | Clickable link text with blue color |
| `url` | Domain extracted and shown below title; full URL available via CopyButton |
| `page_age` | Formatted as human-readable relative time (e.g., "2 days ago") |
| `encrypted_content` | Not shown directly; indicated with "Content retrieved" badge if present |
| `error_code` | Mapped to user-friendly error messages |

---

## Styling & Layout Details

### First Line (Description)
The first line shows the description text with shimmer animation during in-progress state. The chevron controls expand/collapse.
- **Container:** `flex items-center gap-2`
- **Chevron:** `ExpandChevron` with `size="md"` - controls expand/collapse
- **Text:** `ShimmerText`, `text-sm text-zinc-200` - shows "Web search" with shimmer animation when running
- **Status icon:** `StatusIcon` with `isSuccess={false}` on error (appears after description text)
- **Duration/count:** `ml-auto`, `text-xs text-muted-foreground`
- **Note:** No tool-specific icon on this line since the chevron occupies the left position

### Second Line (Command/Details)
The second line shows the command/query details with the tool-specific icon.
- **Container:** `flex items-center gap-1.5 mt-0.5 pl-5` (indented to align with first line text)
- **Icon:** `Globe` from lucide-react, `w-3.5 h-3.5 text-zinc-500` - appears here since first line has chevron
- **Query text:** `text-xs font-mono text-zinc-500`, `truncate`
- **Copy button:** `CopyButton` with `alwaysVisible`

### Expanded Content
- **Container:** `relative mt-2`
- **Results wrapper:** `CollapsibleOutputBlock` with `space-y-2 p-2` inner container
- **Error state:** `text-xs text-red-400`, `border border-red-500/30 bg-red-950/20`

### Result Card Styling
- **Container:** `border border-zinc-700/50 rounded px-3 py-2`, hover: `border-zinc-600/70`
- **Title link:** `text-sm text-blue-400 hover:text-blue-300`, `font-medium`
- **Domain/age:** `text-xs text-zinc-500`
- **Content indicator:** `text-xs text-zinc-600`, green dot indicator

---

## Accessibility Features

1. **ARIA labels:**
   - `aria-label` on container describing the search
   - `aria-expanded` on clickable header

2. **Keyboard navigation:**
   - Header is keyboard focusable (`tabIndex={0}`)
   - Enter/Space toggles expand/collapse
   - Links open in new tab with `target="_blank"` and `rel="noopener noreferrer"`
   - Links have `onClick={(e) => e.stopPropagation()}` to prevent header toggle

3. **Screen reader status:**
   - `sr-only` span announces current state

4. **Data attributes for testing:**
   - `data-testid={`web-search-tool-${id}`}`
   - `data-tool-status={status}`

---

## Error Handling

### API Error Responses
Handle all error codes from `WebSearchToolResultError`:
- `invalid_tool_input` - "Invalid search query"
- `unavailable` - "Web search is temporarily unavailable"
- `max_uses_exceeded` - "Search limit exceeded"
- `too_many_requests` - "Too many search requests"
- `query_too_long` - "Search query is too long"

### Parsing Errors
- Invalid JSON returns `hasError: true` with generic message
- Missing expected fields filters out invalid results gracefully

### Empty Results
- Show "No results found" message
- Different from error state (no red styling)

---

## Testing Strategy

### Unit Tests
- Parse various `WebSearchToolResultBlockContent` formats (success array, error object)
- Handle malformed JSON gracefully
- Validate type guards for `WebSearchResultBlock`
- Test error code mapping

### Integration Tests
- Expand/collapse toggle persists across remounts
- Copy button works for query and URLs
- Keyboard navigation functions correctly
- External links open in new tab

### Visual Regression Tests
- Collapsed state matches BashToolBlock pattern
- Expanded state with 1, 5, 10+ results
- Error state styling
- Long result list with CollapsibleOutputBlock gradient

---

## Acceptance Criteria

- [ ] Component imports and uses `ExpandChevron`, `ShimmerText`, `CopyButton`, `StatusIcon`, and `CollapsibleOutputBlock` from `@/components/ui/`
- [ ] Correctly parses `WebSearchToolResultBlockContent` (both success and error cases)
- [ ] Displays search results as styled cards, not raw JSON
- [ ] Shows user-friendly error messages for all error codes
- [ ] `encrypted_content` is never displayed directly to users
- [ ] `page_age` is formatted as human-readable relative time
- [ ] Long result lists (>5) use `CollapsibleOutputBlock` with gradient fade
- [ ] First line shows: chevron + description text (with ShimmerText animation when running) + status indicators
- [ ] Second line shows: Globe icon + query text + CopyButton (icon only on second line, not first)
- [ ] Query line has CopyButton for copying search query
- [ ] Each result card has CopyButton for copying URL
- [ ] Expand/collapse state persists via `useToolExpandStore`
- [ ] ShimmerText animates during running state
- [ ] ARIA labels and keyboard navigation work correctly
- [ ] Visual styling matches zinc/blue theme
- [ ] Registered in `TOOL_BLOCK_REGISTRY` as `web_search`
