/**
 * Tool block registry.
 * Maps tool names to specialized rendering components.
 */
import type { ComponentType } from "react";
import type { ToolStatus } from "../tool-status-icon";
import { BashToolBlock } from "./bash-tool-block";

export interface ToolBlockProps {
  /** Unique tool use ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Tool execution result (if completed) */
  result?: string;
  /** Whether the result was an error */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
}

type ToolBlockComponent = ComponentType<ToolBlockProps>;

/**
 * Registry mapping tool names (lowercase) to specialized components.
 * Tools not in this registry will use the generic ToolUseBlock.
 */
const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
};

/**
 * Get the appropriate component for rendering a tool block.
 * Returns the specialized component if one exists, otherwise null.
 */
export function getSpecializedToolBlock(
  toolName: string
): ToolBlockComponent | null {
  const normalized = toolName.toLowerCase();
  return TOOL_BLOCK_REGISTRY[normalized] ?? null;
}

export { BashToolBlock };
