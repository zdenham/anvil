/**
 * HTTP hook handler for TUI hook bridge.
 *
 * Express router that handles POST requests from Claude CLI hooks.
 * Calls shared evaluators from core/lib/hooks/ and dispatches state
 * updates via ThreadStateWriter + TranscriptReader.
 * Writes lifecycle events to events.jsonl via EventWriter.
 */

import { Router, json } from "express";
import { evaluateGitCommand } from "@core/lib/hooks/git-safety.js";
import { shouldDenyTool } from "@core/lib/hooks/tool-deny.js";
import { extractFileChange } from "@core/lib/hooks/file-changes.js";
import { parseCommentResolution } from "@core/lib/hooks/comment-resolution.js";
import { ThreadStateWriter } from "./thread-state-writer.js";
import { TranscriptReader } from "./transcript-reader.js";
import { EventWriter } from "./event-writer.js";
import { initiateNaming } from "./naming.js";
import type { EventBroadcaster } from "../push.js";
import type { SidecarLogger } from "../logger.js";

const THREAD_ID_HEADER = "x-anvil-thread-id";

interface HookHandlerDeps {
  dataDir: string;
  broadcaster: EventBroadcaster;
  log: SidecarLogger;
}

interface HookJSONOutput {
  [key: string]: unknown;
}

function denyResponse(reason: string): HookJSONOutput {
  return {
    decision: "deny",
    reason,
  };
}

function allowResponse(): HookJSONOutput {
  return { decision: "allow" };
}

function continueResponse(): HookJSONOutput {
  return {};
}

export function createHookRouter(deps: HookHandlerDeps): Router {
  const { dataDir, broadcaster, log } = deps;
  const stateWriter = new ThreadStateWriter(dataDir, broadcaster, log);
  const transcriptReader = new TranscriptReader(stateWriter, log);
  const eventWriter = new EventWriter(dataDir, log);

  const router = Router();
  router.use(json());

  // ── POST /hooks/user-prompt-submit ────────────────────────────────

  router.post("/user-prompt-submit", async (req, res) => {
    const threadId = req.headers[THREAD_ID_HEADER] as string | undefined;
    if (!threadId) {
      res.json(continueResponse());
      return;
    }

    const prompt: string = (req.body?.prompt as string) ?? "";
    if (!prompt) {
      res.json(continueResponse());
      return;
    }

    log.info(`[hooks] user-prompt-submit for thread ${threadId} (${prompt.length} chars)`);

    // Track user message in thread state
    await stateWriter.dispatch(threadId, {
      type: "APPEND_USER_MESSAGE",
      payload: { content: prompt, id: crypto.randomUUID() },
    });

    // First user message → trigger naming (fire-and-forget)
    const state = stateWriter.getState(threadId);
    const userMessages = state?.messages.filter((m) => m.role === "user") ?? [];
    if (userMessages.length <= 1) {
      initiateNaming(threadId, prompt, { dataDir, broadcaster, log });
    }

    res.json(continueResponse());
  });

  // ── POST /hooks/session-start ──────────────────────────────────────

  router.post("/session-start", async (req, res) => {
    const threadId = req.headers[THREAD_ID_HEADER] as string | undefined;
    if (!threadId) {
      res.json(continueResponse());
      return;
    }

    log.info(`[hooks] session-start for thread ${threadId}`);

    const workingDirectory = (req.body?.cwd as string) ?? "";

    await stateWriter.dispatch(threadId, {
      type: "INIT",
      payload: {
        workingDirectory,
        sessionId: req.body?.session_id as string | undefined,
      },
    });

    eventWriter.sessionStarted(threadId, workingDirectory);

    res.json(continueResponse());
  });

  // ── POST /hooks/pre-tool-use ───────────────────────────────────────

  router.post("/pre-tool-use", async (req, res) => {
    const threadId = req.headers[THREAD_ID_HEADER] as string | undefined;
    const body = req.body ?? {};
    const toolName: string = body.tool_name ?? "";
    const toolInput: Record<string, unknown> = body.tool_input ?? {};
    const toolUseId: string = body.tool_use_id ?? "";

    // 1. Check tool deny list
    const denyResult = shouldDenyTool(toolName);
    if (denyResult.denied) {
      log.info(`[hooks] denied tool ${toolName}: ${denyResult.reason}`);
      if (threadId) {
        eventWriter.toolDenied(threadId, toolName, denyResult.reason);
      }
      res.json(denyResponse(denyResult.reason));
      return;
    }

    // 2. Check git safety for Bash commands
    if (toolName === "Bash") {
      const command = (toolInput.command as string) ?? "";
      const gitResult = evaluateGitCommand(command);
      if (!gitResult.allowed) {
        log.info(`[hooks] denied git command: ${gitResult.reason}`);
        if (threadId) {
          eventWriter.toolDenied(threadId, toolName, gitResult.reason);
        }
        res.json(denyResponse(`${gitResult.reason}. ${gitResult.suggestion}`));
        return;
      }
    }

    // 3. Check for comment resolution
    if (toolName === "Bash") {
      const command = (toolInput.command as string) ?? "";
      const resolution = parseCommentResolution(command);
      if (resolution) {
        log.info(`[hooks] comment resolution: ${resolution.ids.join(",")}`);
        // Allow but broadcast the resolution event
        broadcaster.broadcast("comment-resolved", {
          threadId,
          ids: resolution.ids,
        });
      }
    }

    // 4. Track tool as running + emit lifecycle event
    if (threadId && toolUseId) {
      await stateWriter.dispatch(threadId, {
        type: "MARK_TOOL_RUNNING",
        payload: { toolUseId, toolName },
      });
      eventWriter.toolStarted(threadId, toolName, toolUseId);
    }

    res.json(allowResponse());
  });

  // ── POST /hooks/post-tool-use ──────────────────────────────────────

  router.post("/post-tool-use", async (req, res) => {
    const threadId = req.headers[THREAD_ID_HEADER] as string | undefined;
    const body = req.body ?? {};
    const toolName: string = body.tool_name ?? "";
    const toolInput: Record<string, unknown> = body.tool_input ?? {};
    const toolUseId: string = body.tool_use_id ?? "";
    const transcriptPath: string | undefined = body.transcript_path;

    if (threadId) {
      // 1. Extract file changes
      const fileChange = extractFileChange(toolName, toolInput, "");
      if (fileChange) {
        await stateWriter.dispatch(threadId, {
          type: "UPDATE_FILE_CHANGE",
          payload: { change: fileChange },
        });
        eventWriter.fileModified(threadId, fileChange.path, toolUseId);
      }

      // 2. Mark tool complete + emit lifecycle event
      if (toolUseId) {
        const toolResult = (body.tool_result as string) ?? "";
        const isError = (body.tool_result_is_error as boolean) ?? false;
        await stateWriter.dispatch(threadId, {
          type: "MARK_TOOL_COMPLETE",
          payload: { toolUseId, result: toolResult, isError },
        });
        eventWriter.toolCompleted(threadId, toolName, toolUseId, isError);
      }

      // 3. Sync transcript for messages + usage
      if (transcriptPath) {
        await transcriptReader.syncFromTranscript(threadId, transcriptPath);
      }
    }

    res.json(continueResponse());
  });

  // ── POST /hooks/stop ───────────────────────────────────────────────

  router.post("/stop", async (req, res) => {
    const threadId = req.headers[THREAD_ID_HEADER] as string | undefined;
    const body = req.body ?? {};
    const transcriptPath: string | undefined = body.transcript_path;

    if (threadId) {
      // Final transcript sync
      if (transcriptPath) {
        await transcriptReader.syncFromTranscript(threadId, transcriptPath);
      }

      // Mark thread complete
      await stateWriter.dispatch(threadId, {
        type: "COMPLETE",
        payload: {
          metrics: {
            durationApiMs: 0,
            numTurns: 0,
          },
        },
      });

      eventWriter.sessionEnded(threadId);
      log.info(`[hooks] stop for thread ${threadId}`);

      // Clean up in-memory state
      transcriptReader.reset(threadId);
      stateWriter.evict(threadId);
    }

    res.json(continueResponse());
  });

  return router;
}
