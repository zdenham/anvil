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
 * Handles multiple formats:
 * 1. Standard format: { url, content, final_url? }
 * 2. Plain string (not JSON): treated as content directly
 * 3. Other JSON structures: attempt to extract content or stringify
 */
function parseWebFetchResult(result: string | undefined): WebFetchResult | null {
  if (!result) {
    return null;
  }

  try {
    const parsed = JSON.parse(result);

    // Handle standard format with content property
    if (typeof parsed === "object" && parsed !== null && "content" in parsed) {
      return {
        url: parsed.url || "",
        final_url: parsed.final_url,
        content: parsed.content || "",
      };
    }

    // Handle plain string JSON value (e.g., "\"some content\"")
    if (typeof parsed === "string") {
      return {
        url: "",
        content: parsed,
      };
    }

    // Handle other JSON object formats - stringify for display
    if (typeof parsed === "object" && parsed !== null) {
      return {
        url: "",
        content: JSON.stringify(parsed, null, 2),
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
        <div className="flex items-center gap-1 mt-0.5">
          <Link className="w-4 h-4 text-zinc-500 shrink-0" />
          <span
            className="text-xs font-mono text-zinc-500 truncate flex-1"
            title={url}
          >
            {truncatedUrl}
          </span>
          <CopyButton text={url} label="Copy URL" className="ml-auto" />
        </div>

        {/* Redirect indicator if final URL differs */}
        {hasRedirect && (
          <div className="flex items-center gap-1 mt-0.5 text-xs text-zinc-400">
            <span>Redirected to:</span>
            <span className="font-mono text-zinc-500" title={finalUrl}>
              {truncateUrl(finalUrl)}
            </span>
          </div>
        )}
      </div>

      {/* Expanded Content: Markdown Response */}
      {isExpanded && hasContent && (
        <div className="mt-2">
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

      {/* Expanded, completed, no error, but no content */}
      {isExpanded && !hasContent && !isRunning && !isError && (
        <div className="mt-2 ml-5">
          <div className="text-xs text-zinc-500 italic p-2">
            No content returned
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
