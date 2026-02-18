import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTrickleText } from "@/hooks/use-trickle-text";
import { MarkdownRenderer } from "./markdown-renderer";

interface TrickleBlockProps {
  block: { type: "text" | "thinking"; content: string };
  /** Whether this block is the last (actively streaming) block */
  isLast: boolean;
  workingDirectory?: string;
}

/**
 * Wraps a streaming block with the trickle text hook,
 * giving each block its own independent character-reveal animation.
 */
export function TrickleBlock({ block, isLast, workingDirectory }: TrickleBlockProps) {
  const prefersReduced = useReducedMotion();
  const displayedContent = useTrickleText(block.content, isLast, {
    enabled: !prefersReduced,
  });

  if (block.type === "thinking") {
    return (
      <div className="text-sm text-muted-foreground italic border-l-2 border-secondary-400/30 pl-4">
        {displayedContent}
      </div>
    );
  }

  return (
    <MarkdownRenderer
      content={displayedContent}
      isStreaming={isLast}
      workingDirectory={workingDirectory}
    />
  );
}
