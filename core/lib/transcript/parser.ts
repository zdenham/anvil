/**
 * Transcript .jsonl parser for Claude CLI output.
 * Parses defensively — individual line failures don't break the whole parse.
 * Supports full and incremental reads.
 */

import { readFileSync } from "fs";
import { TranscriptLineSchema, type TranscriptLine } from "./schemas.js";
import type {
  ParsedTranscript,
  ParseError,
  TranscriptMessage,
  TokenUsage,
  ContentBlock,
} from "./types.js";
import { emptyUsage, addUsage } from "./types.js";

function toContentBlock(raw: Record<string, unknown>): ContentBlock {
  return {
    type: raw.type as string,
    text: raw.text as string | undefined,
    thinking: raw.thinking as string | undefined,
    id: raw.id as string | undefined,
    name: raw.name as string | undefined,
    input: raw.input,
    toolUseId: raw.tool_use_id as string | undefined,
    content: raw.content,
  };
}

function toUsage(raw: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }): TokenUsage {
  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cacheCreationInputTokens: raw.cache_creation_input_tokens,
    cacheReadInputTokens: raw.cache_read_input_tokens,
  };
}

function toMessage(line: TranscriptLine): TranscriptMessage {
  const role = (["user", "assistant", "system", "result"].includes(line.type)
    ? line.type
    : "unknown") as TranscriptMessage["role"];

  const msg = line.message;
  const content = (msg?.content ?? []).map((block) => toContentBlock(block as Record<string, unknown>));
  const usage = msg?.usage ? toUsage(msg.usage) : undefined;

  return {
    role,
    content,
    usage,
    uuid: line.uuid,
    stopReason: msg?.stop_reason,
    model: msg?.model,
  };
}

function parseLines(lines: string[], startLineNumber: number): ParsedTranscript {
  const messages: TranscriptMessage[] = [];
  const errors: ParseError[] = [];
  let cliVersion: string | undefined;
  let cumulativeUsage = emptyUsage();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const lineNumber = startLineNumber + i;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      errors.push({ lineNumber, raw: raw.slice(0, 200), error: `JSON parse: ${e}` });
      continue;
    }

    const result = TranscriptLineSchema.safeParse(parsed);
    if (!result.success) {
      errors.push({ lineNumber, raw: raw.slice(0, 200), error: `Zod: ${result.error.message}` });
      continue;
    }

    const line = result.data;

    // Extract CLI version from init message
    if (line.type === "system" && line.subtype === "init") {
      const data = parsed as Record<string, unknown>;
      if (typeof data.cliVersion === "string") {
        cliVersion = data.cliVersion;
      }
    }

    const message = toMessage(line);
    messages.push(message);

    if (message.usage) {
      cumulativeUsage = addUsage(cumulativeUsage, message.usage);
    }
  }

  return { messages, errors, cliVersion, cumulativeUsage };
}

/**
 * Read and parse an entire transcript .jsonl file.
 * Lines that fail JSON.parse or Zod safeParse are logged to errors and skipped.
 */
export function readTranscript(filePath: string): ParsedTranscript {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  return parseLines(lines, 1);
}

/**
 * Incremental read — only parse lines after `fromLine` (1-based).
 * Used for polling: on each hook trigger, read only new lines since last read.
 */
export function readTranscriptIncremental(
  filePath: string,
  fromLine: number,
): { transcript: ParsedTranscript; lastLine: number } {
  const content = readFileSync(filePath, "utf-8");
  const allLines = content.split("\n");
  const newLines = allLines.slice(fromLine);
  const transcript = parseLines(newLines, fromLine + 1);
  return { transcript, lastLine: allLines.length };
}
