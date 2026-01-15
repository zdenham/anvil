import { memo } from "react";
import type { AnnotatedLine } from "./types";

interface AnnotatedLineRowProps {
  /** The annotated line data */
  line: AnnotatedLine;
  /** Callback when line is clicked (for future features like navigation) */
  onLineClick?: (lineNumber: number) => void;
}

/**
 * Single annotated line with proper ARIA semantics.
 * Renders line numbers and content with type-based styling.
 */
export const AnnotatedLineRow = memo(function AnnotatedLineRow({
  line,
  onLineClick,
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
          w-12 flex-shrink-0 px-2 text-right select-none
          ${getLineNumberColor(line.type)}
          border-r border-surface-700/50
        `}
      >
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
          flex-1 px-2 whitespace-pre overflow-x-auto
          ${getContentColor(line.type)}
        `}
      >
        {line.content || " "}
      </span>
    </div>
  );
});

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
