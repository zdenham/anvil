/**
 * Incremental transcript reader for TUI hook bridge.
 *
 * Maintains a cursor per thread so only new transcript lines are parsed
 * on each hook trigger. Extracts messages and usage, dispatches to
 * ThreadStateWriter.
 */

import { readTranscriptIncremental } from "@core/lib/transcript/parser.js";
import type { TranscriptMessage, TokenUsage as TranscriptTokenUsage } from "@core/lib/transcript/types.js";
import type { StoredMessage } from "@core/types/events.js";
import type { ThreadStateWriter } from "./thread-state-writer.js";
import type { SidecarLogger } from "../logger.js";

/**
 * Map transcript TokenUsage (snake_case-ish) to events TokenUsage (camelCase).
 * Transcript uses `cacheCreationInputTokens` / `cacheReadInputTokens`.
 * Events uses `cacheCreationTokens` / `cacheReadTokens`.
 */
function toEventsUsage(u: TranscriptTokenUsage) {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheCreationTokens: u.cacheCreationInputTokens,
    cacheReadTokens: u.cacheReadInputTokens,
  };
}

function transcriptToStoredMessage(msg: TranscriptMessage): StoredMessage {
  const content = msg.content.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text ?? "" };
    if (block.type === "thinking") return { type: "thinking" as const, thinking: block.thinking ?? "" };
    if (block.type === "tool_use") {
      return { type: "tool_use" as const, id: block.id ?? "", name: block.name ?? "", input: block.input };
    }
    if (block.type === "tool_result") {
      return { type: "tool_result" as const, tool_use_id: block.toolUseId ?? "", content: block.content };
    }
    return { type: block.type };
  });

  return {
    id: msg.uuid ?? crypto.randomUUID(),
    role: msg.role as StoredMessage["role"],
    content,
  };
}

export class TranscriptReader {
  private cursors = new Map<string, number>();

  constructor(
    private stateWriter: ThreadStateWriter,
    private log: SidecarLogger,
  ) {}

  async syncFromTranscript(threadId: string, transcriptPath: string): Promise<void> {
    const cursor = this.cursors.get(threadId) ?? 0;

    let result;
    try {
      result = readTranscriptIncremental(transcriptPath, cursor);
    } catch (err) {
      this.log.warn(`Failed to read transcript for thread ${threadId}: ${err}`);
      return;
    }

    this.cursors.set(threadId, result.lastLine);
    const { transcript } = result;

    if (transcript.errors.length > 0) {
      this.log.warn(
        `Transcript parse errors for thread ${threadId}: ${transcript.errors.length} errors at lines ${transcript.errors.map((e) => e.lineNumber).join(",")}`,
      );
    }

    for (const msg of transcript.messages) {
      if (msg.role === "assistant") {
        await this.stateWriter.dispatch(threadId, {
          type: "APPEND_ASSISTANT_MESSAGE",
          payload: { message: transcriptToStoredMessage(msg) },
        });
      }

      if (msg.usage) {
        await this.stateWriter.dispatch(threadId, {
          type: "UPDATE_USAGE",
          payload: { usage: toEventsUsage(msg.usage) },
        });
      }
    }
  }

  /** Reset cursor for a thread. */
  reset(threadId: string): void {
    this.cursors.delete(threadId);
  }
}
