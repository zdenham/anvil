/**
 * Types for parsed transcript data.
 * Transcript .jsonl files are written by Claude CLI — internal format with no stability guarantees.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  toolUseId?: string;
  content?: unknown;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "result" | "unknown";
  content: ContentBlock[];
  usage?: TokenUsage;
  uuid?: string;
  stopReason?: string;
  model?: string;
}

export interface ParseError {
  lineNumber: number;
  raw: string;
  error: string;
}

export interface ParsedTranscript {
  messages: TranscriptMessage[];
  errors: ParseError[];
  cliVersion?: string;
  cumulativeUsage: TokenUsage;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}
