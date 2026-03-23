/**
 * Zod schemas for Claude CLI transcript .jsonl lines.
 * All schemas use safeParse — unknown fields are passed through, missing fields get defaults.
 * Internal format with no stability guarantees — parse defensively.
 */

import { z } from "zod";

export const UsageSchema = z.object({
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  cache_creation_input_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
}).passthrough();

const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
}).passthrough();

const ThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
}).passthrough();

const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
}).passthrough();

const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.unknown(),
}).passthrough();

const FallbackBlockSchema = z.object({
  type: z.string(),
}).passthrough();

export const ContentBlockSchema = z.union([
  TextBlockSchema,
  ThinkingBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  FallbackBlockSchema,
]);

export const TranscriptLineSchema = z.object({
  type: z.string().default("unknown"),
  message: z.object({
    content: z.array(ContentBlockSchema).default([]),
    usage: UsageSchema.optional(),
    stop_reason: z.string().optional(),
    model: z.string().optional(),
  }).passthrough().optional(),
  uuid: z.string().optional(),
  session_id: z.string().optional(),
  subtype: z.string().optional(),
}).passthrough();

export type TranscriptLine = z.infer<typeof TranscriptLineSchema>;
