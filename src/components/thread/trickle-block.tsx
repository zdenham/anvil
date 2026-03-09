import { memo } from "react";
import { Brain } from "lucide-react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTrickleText } from "@/hooks/use-trickle-text";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { MarkdownRenderer } from "./markdown-renderer";

interface TrickleBlockProps {
  block: { type: "text" | "thinking"; content: string };
  /** Whether this block is the last (actively streaming) block */
  isLast: boolean;
  workingDirectory?: string;
  threadId?: string;
  blockKey?: string;
}

function StreamingThinkingBlock({
  threadId,
  blockKey,
  displayedContent,
}: {
  threadId: string;
  blockKey: string;
  displayedContent: string;
}) {
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, blockKey),
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId, blockKey, expanded);

  const preview =
    displayedContent.length > 100
      ? displayedContent.slice(0, 100) + "..."
      : displayedContent;

  const header = (
    <>
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <ShimmerText isShimmering className="text-sm text-zinc-200">
          Thinking
        </ShimmerText>
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <Brain className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <span className="text-xs text-zinc-500 truncate min-w-0 flex-1 italic">
          {preview}
        </span>
      </div>
    </>
  );

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      ariaLabel="Assistant reasoning"
      className="py-0.5"
      header={header}
    >
      <pre className="mt-2 ml-5 text-xs text-zinc-400 p-2 rounded bg-zinc-950 overflow-x-auto max-h-64 overflow-y-auto">
        <code className="whitespace-pre-wrap">{displayedContent}</code>
      </pre>
    </CollapsibleBlock>
  );
}

/**
 * Wraps a streaming block with the trickle text hook,
 * giving each block its own independent character-reveal animation.
 */
export const TrickleBlock = memo(function TrickleBlock({
  block,
  isLast,
  workingDirectory,
  threadId,
  blockKey,
}: TrickleBlockProps) {
  const prefersReduced = useReducedMotion();
  const displayedContent = useTrickleText(block.content, isLast, {
    enabled: !prefersReduced,
  });

  if (block.type === "thinking" && threadId && blockKey) {
    return (
      <StreamingThinkingBlock
        threadId={threadId}
        blockKey={blockKey}
        displayedContent={displayedContent}
      />
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
