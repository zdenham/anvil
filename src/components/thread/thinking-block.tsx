import { Brain } from "lucide-react";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { ExpandChevron } from "@/components/ui/expand-chevron";

interface ThinkingBlockProps {
  /** Thinking/reasoning content */
  content: string;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
  /** Unique key for expand state persistence */
  blockKey: string;
}

/**
 * Collapsible block for agent extended thinking.
 * Uses the same layout as specialized tool blocks.
 */
export function ThinkingBlock({
  content,
  threadId,
  blockKey,
}: ThinkingBlockProps) {
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, blockKey)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId, blockKey, expanded);

  const preview =
    content.length > 100 ? content.slice(0, 100) + "..." : content;

  const header = (
    <>
      {/* First line: chevron + description */}
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <span className="text-sm text-zinc-200">Thinking</span>
      </div>

      {/* Second line: icon + preview */}
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
        <code className="whitespace-pre-wrap">{content}</code>
      </pre>
    </CollapsibleBlock>
  );
}
