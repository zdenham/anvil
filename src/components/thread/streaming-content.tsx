import { useStreamingStore } from "@/stores/streaming-store";
import { MarkdownRenderer } from "./markdown-renderer";
import { StreamingCursor } from "./streaming-cursor";

interface StreamingContentProps {
  threadId: string;
  workingDirectory?: string;
}

/**
 * Renders optimistic streaming content from the agent before
 * it is persisted to the thread state file.
 *
 * Subscribes to the streaming store for ephemeral blocks (text + thinking)
 * and renders them with a blinking cursor at the end.
 */
export function StreamingContent({ threadId, workingDirectory }: StreamingContentProps) {
  const stream = useStreamingStore((s) => s.activeStreams[threadId]);

  if (!stream || stream.blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5" role="status" aria-label="Assistant is responding">
      {stream.blocks.map((block, index) => {
        const isLast = index === stream.blocks.length - 1;
        const hasContent = block.content.length > 0;

        return (
          <div key={index} className="relative">
            {block.type === "thinking" ? (
              <div className="text-sm text-muted-foreground italic border-l-2 border-secondary-400/30 pl-4">
                {block.content}
              </div>
            ) : (
              <MarkdownRenderer
                content={block.content}
                isStreaming={isLast}
                workingDirectory={workingDirectory}
              />
            )}
            {isLast && hasContent && <StreamingCursor />}
          </div>
        );
      })}
    </div>
  );
}
