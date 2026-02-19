import { z } from "zod";

// ============================================================================
// Pipeline Stage — tracks where a message is in the event delivery pipeline
// ============================================================================

/**
 * Zod schema for pipeline stages.
 *
 * Each stage represents a hop in the event delivery pipeline:
 *   Agent (Node.js) -> Socket Write -> AgentHub (Rust) -> Tauri emit -> Frontend listener
 */
export const PipelineStageSchema = z.enum([
  "agent:sent",        // Agent wrote message to socket
  "hub:received",      // Rust hub parsed the message from socket
  "hub:emitted",       // Rust hub called app_handle.emit()
  "frontend:received", // Frontend agent:message listener fired
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

// ============================================================================
// Pipeline Stamp — timestamp + sequence at a given stage
// ============================================================================

/**
 * Zod schema for pipeline stamps.
 *
 * Attached to every message as it passes through each pipeline stage.
 * Enables latency measurement and drop detection between hops.
 */
export const PipelineStampSchema = z.object({
  /** Which pipeline stage this stamp was recorded at */
  stage: PipelineStageSchema,
  /** Monotonic per-agent sequence number (gaps indicate dropped messages) */
  seq: z.number(),
  /** Timestamp at this stage (ms since epoch) */
  ts: z.number(),
});
export type PipelineStamp = z.infer<typeof PipelineStampSchema>;
