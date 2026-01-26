import { z } from "zod";

export const LogLevelSchema = z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Individual log row - matches ClickHouse schema exactly.
 */
export const LogRowSchema = z.object({
  timestamp: z.number(), // DateTime64(3) as milliseconds since epoch
  device_id: z.string(), // Unique device identifier for tracking
  level: LogLevelSchema,
  message: z.string(),
});

export type LogRow = z.infer<typeof LogRowSchema>;

/**
 * Batch of logs sent from client to server
 */
export const LogBatchSchema = z.object({
  logs: z.array(LogRowSchema),
});

export type LogBatch = z.infer<typeof LogBatchSchema>;

/**
 * Server response for successful log insertion
 */
export const LogInsertResponseSchema = z.object({
  status: z.literal("ok"),
  inserted: z.number(),
});

export type LogInsertResponse = z.infer<typeof LogInsertResponseSchema>;

/**
 * Server response for errors
 */
export const LogErrorResponseSchema = z.object({
  status: z.literal("error"),
  message: z.string(),
});

export type LogErrorResponse = z.infer<typeof LogErrorResponseSchema>;

/**
 * Union of all possible server responses
 */
export const LogResponseSchema = z.discriminatedUnion("status", [
  LogInsertResponseSchema,
  LogErrorResponseSchema,
]);

export type LogResponse = z.infer<typeof LogResponseSchema>;
