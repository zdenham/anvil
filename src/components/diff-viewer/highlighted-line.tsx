import type { ThemedToken } from "shiki";
import { cn } from "@/lib/utils";

export type LineType = "context" | "addition" | "deletion";

interface HighlightedLineProps {
  /** Pre-tokenized content from Shiki highlighter */
  tokens: ThemedToken[];
  /** Type of diff line */
  lineType: LineType;
  /** Line number in old file (null for additions) */
  oldLineNumber: number | null;
  /** Line number in new file (null for deletions) */
  newLineNumber: number | null;
}

const LINE_TYPE_STYLES: Record<LineType, { bg: string; border: string }> = {
  addition: {
    bg: "bg-emerald-950/50",
    border: "border-l-2 border-emerald-500",
  },
  deletion: {
    bg: "bg-red-950/50",
    border: "border-l-2 border-red-500",
  },
  context: {
    bg: "bg-transparent",
    border: "border-l-2 border-transparent",
  },
};

const LINE_NUMBER_STYLES = "text-zinc-500 select-none w-12 text-right pr-2 font-mono text-xs";

/**
 * Renders a single line of syntax-highlighted diff content.
 *
 * Receives pre-tokenized content to preserve syntax context from
 * multi-line constructs like strings and comments.
 */
export function HighlightedLine({
  tokens,
  lineType,
  oldLineNumber,
  newLineNumber,
}: HighlightedLineProps) {
  const styles = LINE_TYPE_STYLES[lineType];

  return (
    <div
      className={cn(
        "flex font-mono text-sm leading-relaxed",
        styles.bg,
        styles.border
      )}
    >
      {/* Old line number */}
      <span className={LINE_NUMBER_STYLES}>
        {oldLineNumber ?? ""}
      </span>

      {/* New line number */}
      <span className={LINE_NUMBER_STYLES}>
        {newLineNumber ?? ""}
      </span>

      {/* Line content */}
      <code className="flex-1 px-2 whitespace-pre overflow-x-auto">
        {tokens.length === 0 ? (
          // Empty line - render a space to maintain height
          <span>&nbsp;</span>
        ) : (
          tokens.map((token, index) => (
            <span
              key={index}
              style={{ color: token.color }}
            >
              {token.content}
            </span>
          ))
        )}
      </code>
    </div>
  );
}
