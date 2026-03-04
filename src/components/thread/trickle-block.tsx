import { memo } from "react";
import { Brain } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTrickleText } from "@/hooks/use-trickle-text";
import { ShimmerText } from "@/components/ui/shimmer-text";
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
export const TrickleBlock = memo(function TrickleBlock({ block, isLast, workingDirectory }: TrickleBlockProps) {
  const prefersReduced = useReducedMotion();
  const displayedContent = useTrickleText(block.content, isLast, {
    enabled: !prefersReduced,
  });

  if (block.type === "thinking") {
    return (
      <div className="py-0.5">
        <div className="flex items-center gap-2">
          <ChevronRight className="h-4 w-4 shrink-0 text-white -ml-1 -mr-1.5" />
          <ShimmerText isShimmering className="text-sm text-zinc-200">
            Thinking
          </ShimmerText>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Brain className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-500 truncate min-w-0 flex-1 italic">
            {displayedContent.slice(0, 100)}
          </span>
        </div>
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
});
