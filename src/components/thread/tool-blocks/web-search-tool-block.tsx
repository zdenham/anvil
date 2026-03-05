import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { CopyButton } from "@/components/ui/copy-button";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { StatusIcon } from "@/components/ui/status-icon";
import { Globe, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { ToolBlockProps } from "./index";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Input shape for web search tool use.
 * The SDK types this as `unknown`, but based on WebSearchTool20250305 config.
 */
interface WebSearchInput {
  query: string;
  allowed_domains?: string[] | null;
  blocked_domains?: string[] | null;
}

type WebSearchResultBlock = Anthropic.WebSearchResultBlock;

interface ParsedWebSearchResult {
  results: WebSearchResultBlock[];
  hasError: boolean;
  errorCode?: string;
  errorMessage?: string;
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

/**
 * Client-side WebSearch result format (from the WebSearch tool proxy).
 */
interface ClientWebSearchResult {
  query: string;
  results: Array<
    | { tool_use_id: string; content: Array<{ title: string; url: string }> }
    | string // Summary text from Claude
  >;
  durationSeconds?: number;
}

/**
 * Parse the result string which contains JSON-stringified results.
 * Handles multiple formats:
 * 1. Server-side: WebSearchToolResultBlockContent (array of WebSearchResultBlock or error)
 * 2. Client-side: { query, results: [...], durationSeconds } from WebSearch tool
 */
function parseWebSearchResult(
  result: string | undefined,
  _isError?: boolean
): ParsedWebSearchResult {
  if (!result) {
    return { results: [], hasError: false };
  }

  try {
    const parsed = JSON.parse(result);

    // Check if it's an error response (server-side format)
    if (parsed?.type === "web_search_tool_result_error") {
      return {
        results: [],
        hasError: true,
        errorCode: parsed.error_code,
        errorMessage: getErrorMessage(parsed.error_code),
      };
    }

    // Check if it's an array of results (server-side format)
    if (Array.isArray(parsed)) {
      const validResults = parsed.filter(
        (item): item is WebSearchResultBlock =>
          item?.type === "web_search_result" &&
          typeof item.title === "string" &&
          typeof item.url === "string"
      );
      return { results: validResults, hasError: false };
    }

    // Check if it's client-side WebSearch tool format
    // Format: { query: string, results: [...], durationSeconds?: number }
    if (parsed?.results && Array.isArray(parsed.results)) {
      const clientResult = parsed as ClientWebSearchResult;
      const extractedResults: WebSearchResultBlock[] = [];

      for (const item of clientResult.results) {
        // Skip string items (summary text from Claude)
        if (typeof item === "string") continue;

        // Extract results from { tool_use_id, content: [...] } format
        if (item?.content && Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (
              typeof contentItem === "object" &&
              contentItem !== null &&
              typeof contentItem.title === "string" &&
              typeof contentItem.url === "string"
            ) {
              // Convert to WebSearchResultBlock format
              extractedResults.push({
                type: "web_search_result",
                url: contentItem.url,
                title: contentItem.title,
                encrypted_content: "", // Not available in client format
                page_age: (contentItem as { page_age?: string }).page_age ?? null,
              });
            }
          }
        }
      }

      return { results: extractedResults, hasError: false };
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
  if (
    pageAge.includes("ago") ||
    pageAge.includes("day") ||
    pageAge.includes("week")
  ) {
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
    if (diffDays < 30)
      return `${Math.floor(diffDays / 7)} week${diffDays >= 14 ? "s" : ""} ago`;
    if (diffDays < 365)
      return `${Math.floor(diffDays / 30)} month${diffDays >= 60 ? "s" : ""} ago`;
    return `${Math.floor(diffDays / 365)} year${diffDays >= 730 ? "s" : ""} ago`;
  } catch {
    return pageAge;
  }
}

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
          className="text-sm text-zinc-200 hover:text-white underline flex-1 min-w-0 break-words font-medium"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            open(url);
          }}
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

const RESULT_COLLAPSE_THRESHOLD = 5; // Number of results before offering collapse
const MAX_COLLAPSED_HEIGHT = 400; // Max height when collapsed (pixels)

/**
 * Extended props for WebSearchToolBlock.
 * When rendered for a server_tool_use block, the parent passes result data
 * via override props since server_tool_use results come from sibling content
 * blocks rather than from toolStates.
 */
export interface WebSearchToolBlockProps extends ToolBlockProps {
  /** Override result from server_tool_use sibling block (not from toolStates) */
  serverResult?: string;
  /** Override isError from server_tool_use sibling block */
  serverIsError?: boolean;
  /** Override status from server_tool_use sibling block */
  serverStatus?: "running" | "complete";
}

/**
 * Specialized block for rendering WebSearch tool calls.
 * Displays search results in a clean, card-based format.
 */
export function WebSearchToolBlock({
  id,
  name: _name,
  input,
  threadId,
  serverResult,
  serverIsError,
  serverStatus,
}: WebSearchToolBlockProps) {
  const hookState = useToolState(threadId, id);

  // Use server overrides when provided (server_tool_use path), otherwise fall back to hook
  const status = serverStatus ?? hookState.status;
  const result = serverResult ?? hookState.result;
  const isError = serverIsError ?? hookState.isError ?? false;
  // 1. Parse input and result
  const webSearchInput = input as unknown as WebSearchInput;
  const query = webSearchInput.query || "";
  const {
    results,
    hasError,
    errorCode,
    errorMessage,
  } = parseWebSearchResult(result, isError);

  // 2. Use expand state store (persists across virtualization remounts)
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, id)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId, id, expanded);

  // 3. Use output expand state for long result lists
  const isLongOutput = results.length > RESULT_COLLAPSE_THRESHOLD;
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore(
    (state) => state.setOutputExpanded
  );
  const setIsOutputExpanded = (expanded: boolean) =>
    setOutputExpanded(threadId, id, expanded);

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
          <ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200">
            Web search
          </ShimmerText>

          {/* Error indicator - only show on failure */}
          {!isRunning && showError && <StatusIcon isSuccess={false} size="sm" />}

          {/* Result count - right justified */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {!isRunning && hasResults && (
              <span className="text-xs text-zinc-500">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
        </div>

        {/* Second line: icon + query text (command/details) */}
        {/* The Globe icon appears here since first line has the chevron */}
        {query && (
          <div className="flex items-center gap-1 mt-0.5">
            <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
              <span className="truncate">{query}</span>
            </code>
            <CopyButton text={query} label="Copy query" alwaysVisible className="ml-auto" />
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
