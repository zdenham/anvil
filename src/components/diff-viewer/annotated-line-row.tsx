import { memo } from "react";
import type { ThemedToken } from "shiki";
import type { AnnotatedLine } from "./types";
import { CommentGutterButton } from "./comment-gutter-button";

interface AnnotatedLineRowProps {
  /** The annotated line data */
  line: AnnotatedLine;
  /** Callback when line is clicked (for comment form opening) */
  onLineClick?: (lineNumber: number) => void;
  /** Whether this line has comments (shows indicator dot) */
  hasComments?: boolean;
}

/**
 * Single annotated line with proper ARIA semantics.
 * Renders line numbers and content with type-based styling.
 */
export const AnnotatedLineRow = memo(function AnnotatedLineRow({
  line,
  onLineClick,
  hasComments,
}: AnnotatedLineRowProps) {
  const lineNumber = line.newLineNumber ?? line.oldLineNumber ?? 0;

  const handleClick = () => {
    if (onLineClick && lineNumber) {
      onLineClick(lineNumber);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  // Generate aria-label based on line type
  const ariaLabel = `Line ${lineNumber}: ${
    line.type === "addition"
      ? "added"
      : line.type === "deletion"
        ? "deleted"
        : "unchanged"
  }`;

  return (
    <div
      role="row"
      aria-label={ariaLabel}
      className={`
        flex font-mono text-sm leading-6 min-h-6
        ${getLineBackground(line.type)}
        ${onLineClick ? "cursor-pointer hover:brightness-110" : ""}
        group
      `}
      onClick={onLineClick ? handleClick : undefined}
      onKeyDown={onLineClick ? handleKeyDown : undefined}
      tabIndex={onLineClick ? 0 : undefined}
    >
      {/* Old line number */}
      <span
        role="cell"
        aria-label="Old line number"
        className={`
          relative w-12 flex-shrink-0 px-2 text-right select-none
          ${getLineNumberColor(line.type)}
          border-r border-surface-700/50
        `}
      >
        {onLineClick && (
          <CommentGutterButton onClick={() => onLineClick(lineNumber)} lineNumber={lineNumber} />
        )}
        {hasComments && !onLineClick && (
          <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-400" />
        )}
        {line.oldLineNumber ?? ""}
      </span>

      {/* New line number */}
      <span
        role="cell"
        aria-label="New line number"
        className={`
          w-12 flex-shrink-0 px-2 text-right select-none
          ${getLineNumberColor(line.type)}
          border-r border-surface-700/50
        `}
      >
        {line.newLineNumber ?? ""}
      </span>

      {/* Type indicator */}
      <span
        role="cell"
        aria-hidden="true"
        className={`
          w-6 flex-shrink-0 text-center select-none
          ${getTypeIndicatorColor(line.type)}
        `}
      >
        {getTypeIndicator(line.type)}
      </span>

      {/* Line content */}
      <span
        role="cell"
        className={`
          flex-1 px-2 whitespace-pre
          ${line.tokens ? "" : getContentColor(line.type)}
        `}
      >
        {line.tokens ? (
          <TokenizedContent tokens={line.tokens} />
        ) : (
          line.content || " "
        )}
      </span>
    </div>
  );
});

/**
 * Renders syntax-highlighted tokens as colored spans.
 */
function TokenizedContent({ tokens }: { tokens: ThemedToken[] }) {
  if (tokens.length === 0) {
    return <span>&nbsp;</span>;
  }

  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  );
}

// Helper functions for styling

function getLineBackground(type: AnnotatedLine["type"]): string {
  switch (type) {
    case "addition":
      return "bg-emerald-950/30 border-l-2 border-emerald-500";
    case "deletion":
      return "bg-red-950/30 border-l-2 border-red-500";
    default:
      return "border-l-2 border-transparent hover:bg-surface-800/30";
  }
}

function getLineNumberColor(type: AnnotatedLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-emerald-600";
    case "deletion":
      return "text-red-600";
    default:
      return "text-surface-500";
  }
}

function getTypeIndicator(type: AnnotatedLine["type"]): string {
  switch (type) {
    case "addition":
      return "+";
    case "deletion":
      return "-";
    default:
      return " ";
  }
}

function getTypeIndicatorColor(type: AnnotatedLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-emerald-400";
    case "deletion":
      return "text-red-400";
    default:
      return "text-transparent";
  }
}

function getContentColor(type: AnnotatedLine["type"]): string {
  switch (type) {
    case "addition":
      return "text-emerald-300";
    case "deletion":
      return "text-red-300";
    default:
      return "text-surface-300";
  }
}
