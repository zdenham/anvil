import { memo } from "react";
import { cn } from "@/lib/utils";
import { StreamingCursor } from "./streaming-cursor";
import { MarkdownRenderer } from "./markdown-renderer";

interface TextBlockProps {
  /** Markdown text content */
  content: string;
  /** Whether this block is still receiving content */
  isStreaming?: boolean;
  className?: string;
  /** Working directory for resolving relative file paths */
  workingDirectory?: string;
}

/**
 * Renders markdown text content.
 * Always uses MarkdownRenderer for consistent code block handling.
 */
export const TextBlock = memo(function TextBlock({
  content,
  isStreaming = false,
  className,
  workingDirectory,
}: TextBlockProps) {
  return (
    <div className={cn("relative", className)}>
      <MarkdownRenderer content={content} isStreaming={isStreaming} workingDirectory={workingDirectory} />
      {isStreaming && <StreamingCursor className="ml-1" />}
    </div>
  );
});
