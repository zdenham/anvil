import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { StreamingCursor } from "./streaming-cursor";
import { MarkdownRenderer } from "./markdown-renderer";

interface TextBlockProps {
  /** Markdown text content */
  content: string;
  /** Whether this block is still receiving content */
  isStreaming?: boolean;
  className?: string;
}

/**
 * Renders markdown text with streaming support.
 * Uses Streamdown for streaming messages (handles incomplete markdown gracefully).
 * Uses MarkdownRenderer for completed messages (provides syntax highlighting).
 */
export function TextBlock({
  content,
  isStreaming = false,
  className,
}: TextBlockProps) {
  return (
    <div
      className={cn(
        // Prose styles for Streamdown during streaming
        // (MarkdownRenderer owns its own prose styles)
        isStreaming && "prose prose-invert prose-sm max-w-none",
        isStreaming && "prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800",
        isStreaming && "prose-code:text-amber-400 prose-code:before:content-none prose-code:after:content-none",
        isStreaming && "prose-a:text-accent-400 prose-a:no-underline hover:prose-a:underline",
        className
      )}
    >
      {isStreaming ? (
        <>
          <Streamdown>{content}</Streamdown>
          <StreamingCursor />
        </>
      ) : (
        <MarkdownRenderer content={content} />
      )}
    </div>
  );
}
