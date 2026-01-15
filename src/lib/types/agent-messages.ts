import type {
  MessageParam,
  ContentBlock,
} from "@anthropic-ai/sdk/resources/messages";

// Re-export SDK types for convenience
export type { MessageParam, ContentBlock };

// Re-export shared types and schemas from core
export {
  ThreadStateSchema,
  type FileChange,
  type ResultMetrics,
  type ThreadState,
  type ToolExecutionState,
} from "@core/types/events";

/**
 * System initialization info (app-specific, not from SDK).
 * Shows model and tools at the start of a thread.
 */
export interface SystemInit {
  model: string;
  tools: string[];
}

/**
 * System message for rendering init info in the UI.
 */
export interface SystemMessage {
  type: "system";
  subtype: "init";
  model: string;
  tools: string[];
  timestamp: number;
}
