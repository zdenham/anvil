import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  /** Thinking/reasoning content */
  content: string;
  /** Whether to show expanded by default */
  defaultExpanded?: boolean;
}

/**
 * Collapsible block for agent extended thinking.
 * Collapsed by default to reduce visual noise.
 */
export function ThinkingBlock({
  content,
  defaultExpanded = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Truncate preview to first 100 characters
  const preview =
    content.length > 100 ? content.slice(0, 100) + "..." : content;

  return (
    <details
      open={isExpanded}
      onToggle={(e) => setIsExpanded(e.currentTarget.open)}
      className="group"
      aria-label="Assistant reasoning"
    >
      <summary
        className={cn(
          "flex items-center gap-2 cursor-pointer select-none",
          "text-sm text-muted-foreground hover:text-foreground",
          "list-none [&::-webkit-details-marker]:hidden"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <Brain className="h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />
        <span className="font-medium">Thinking</span>
        {!isExpanded && (
          <span className="truncate opacity-60 italic">{preview}</span>
        )}
      </summary>

      <div
        role="region"
        aria-label="Thinking content"
        className={cn(
          "mt-2 pl-6 text-sm text-muted-foreground italic",
          "border-l-2 border-secondary-400/30"
        )}
      >
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </details>
  );
}
