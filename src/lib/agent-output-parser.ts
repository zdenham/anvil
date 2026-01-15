import type { AgentOutput } from "@core/types/events.js";
import {
  AgentOutputSchema,
  AgentEventMessageSchema,
  AgentStateMessageSchema,
  AgentLogMessageSchema,
} from "@core/types/events.js";
import { logger } from "./logger-client.js";

/**
 * Parse a line of agent stdout output into a typed AgentOutput.
 *
 * The agent emits JSON lines with a "type" field indicating the message kind:
 * - "event": domain events with name and payload
 * - "state": thread state snapshots
 * - "log": structured log messages
 *
 * Returns null for empty lines, non-JSON lines, or invalid messages.
 * Uses Zod schemas for runtime validation at the trust boundary.
 */
export function parseAgentOutput(line: string): AgentOutput | null {
  const trimmed = line.trim();

  if (trimmed === "") {
    return null;
  }

  if (!trimmed.startsWith("{")) {
    return null;
  }

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    logger.debug("Failed to parse agent output as JSON");
    return null;
  }

  const result = AgentOutputSchema.safeParse(obj);

  if (!result.success) {
    // Log the actual payload to help diagnose what's being rejected
    const parsed = obj as Record<string, unknown>;
    if (parsed.type === "event") {
      logger.warn(
        `[agent-output-parser] Rejected event with name="${parsed.name}". ` +
        `Payload: ${JSON.stringify(parsed.payload)}`
      );
    }
    logger.debug(`Invalid agent output: ${result.error.message}`);
    return null;
  }

  return result.data as AgentOutput;
}

// Re-export schemas for consumers who need them
export {
  AgentOutputSchema,
  AgentEventMessageSchema,
  AgentStateMessageSchema,
  AgentLogMessageSchema,
};
