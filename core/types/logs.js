import { z } from "zod";
export const LogLevelSchema = z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);
/**
 * Individual log row - matches ClickHouse schema exactly.
 */
export const LogRowSchema = z.object({
    timestamp: z.number(), // DateTime64(3) as milliseconds since epoch
    level: LogLevelSchema,
    message: z.string(),
});
/**
 * Batch of logs sent from client to server
 */
export const LogBatchSchema = z.object({
    logs: z.array(LogRowSchema),
});
/**
 * Server response for successful log insertion
 */
export const LogInsertResponseSchema = z.object({
    status: z.literal("ok"),
    inserted: z.number(),
});
/**
 * Server response for errors
 */
export const LogErrorResponseSchema = z.object({
    status: z.literal("error"),
    message: z.string(),
});
/**
 * Union of all possible server responses
 */
export const LogResponseSchema = z.discriminatedUnion("status", [
    LogInsertResponseSchema,
    LogErrorResponseSchema,
]);
