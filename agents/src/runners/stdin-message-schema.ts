import { z } from "zod";

/**
 * Schema for messages sent from frontend to agent via stdin.
 *
 * Frontend sends JSON lines to stdin when the user queues messages
 * while the agent is actively running.
 */
export const StdinMessageSchema = z.object({
  type: z.literal("queued_message"),
  id: z.string().uuid(),
  content: z.string().min(1),
  timestamp: z.number(),
});

export type StdinMessage = z.infer<typeof StdinMessageSchema>;

/**
 * Parse a stdin line as a StdinMessage.
 * Returns null if the line is not valid JSON or doesn't match the schema.
 */
export function parseStdinMessage(line: string): StdinMessage | null {
  try {
    const parsed = JSON.parse(line);
    const result = StdinMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
