/**
 * Background Task Lifecycle Spike
 *
 * Empirically determines how background tasks behave in the Claude Agent SDK.
 *
 * Environment variables:
 *   MODE - Controls post-iterator behavior:
 *     "observe"        (default) Keep consuming iterator, log every message with timestamps
 *     "wait"           Don't exit after iterator ends; wait 30s, then check signal file
 *     "exit_immediate" Call process.exit(0) as soon as iterator ends; outer test checks signal file
 *
 * Stdout protocol (JSON lines):
 *   { type: "config", mode, timestamp, signalFile }
 *   { type: "message", ts, elapsed_ms, messageType, subtype?, content }
 *   { type: "iterator_done", ts, elapsed_ms }
 *   { type: "process_tree", ts, ps_output }
 *   { type: "signal_check", ts, file, exists, contents? }
 *   { type: "result", ... }
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";

type Mode = "observe" | "wait" | "exit_immediate";
const MODE = (process.env.MODE ?? "observe") as Mode;
const TIMESTAMP = Date.now();
const SIGNAL_FILE = `/tmp/bg-spike-${TIMESTAMP}.txt`;
const FG_MARKER_FILE = `/tmp/bg-spike-${TIMESTAMP}-fg.txt`;
const START = Date.now();

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function elapsed(): number {
  return Date.now() - START;
}

function captureProcessTree(): string {
  try {
    return execSync("ps -eo pid,ppid,command", { encoding: "utf-8", timeout: 5000 });
  } catch {
    return "<ps failed>";
  }
}

function checkSignalFile(): { exists: boolean; contents?: string } {
  const exists = existsSync(SIGNAL_FILE);
  if (exists) {
    try {
      const contents = readFileSync(SIGNAL_FILE, "utf-8").trim();
      return { exists, contents };
    } catch {
      return { exists, contents: "<read error>" };
    }
  }
  return { exists };
}

function checkFgMarker(): { exists: boolean; contents?: string } {
  const exists = existsSync(FG_MARKER_FILE);
  if (exists) {
    try {
      const contents = readFileSync(FG_MARKER_FILE, "utf-8").trim();
      return { exists, contents };
    } catch {
      return { exists, contents: "<read error>" };
    }
  }
  return { exists };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  emit({
    type: "config",
    mode: MODE,
    timestamp: TIMESTAMP,
    signalFile: SIGNAL_FILE,
    fgMarkerFile: FG_MARKER_FILE,
    pid: process.pid,
  });

  // Prompt: launch a background sleep, then a foreground marker, then respond
  const prompt = [
    `You must do EXACTLY these three things in order:`,
    ``,
    `1. Use the Bash tool with run_in_background set to true to run this exact command:`,
    `   sleep 20 && echo "BACKGROUND_DONE" > ${SIGNAL_FILE}`,
    ``,
    `2. Use the Bash tool (foreground, NOT background) to run:`,
    `   echo "FOREGROUND_MARKER" > ${FG_MARKER_FILE}`,
    ``,
    `3. After both commands, respond with EXACTLY the text: FOREGROUND_DONE`,
    ``,
    `Do not use any other tools. Do not do anything else.`,
  ].join("\n");

  const result = query({
    prompt,
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 6,
    },
  });

  let messageCount = 0;
  const messageTypes: string[] = [];

  try {
    for await (const message of result) {
      messageCount++;
      const msg = message as Record<string, unknown>;
      const msgType = msg.type as string;
      const subtype = (msg as { subtype?: string }).subtype;
      messageTypes.push(subtype ? `${msgType}:${subtype}` : msgType);

      emit({
        type: "message",
        ts: Date.now(),
        elapsed_ms: elapsed(),
        messageType: msgType,
        subtype: subtype ?? null,
        index: messageCount,
        // For assistant messages, include text content summary
        ...(msgType === "assistant" && {
          textPreview: extractTextPreview(msg),
        }),
        // For result messages, include full content
        ...(msgType === "result" && { content: msg }),
      });
    }
  } catch (err) {
    emit({
      type: "error",
      ts: Date.now(),
      elapsed_ms: elapsed(),
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Iterator done
  emit({
    type: "iterator_done",
    ts: Date.now(),
    elapsed_ms: elapsed(),
    messageCount,
    messageTypes,
  });

  // Capture process tree immediately
  const psOutput = captureProcessTree();
  emit({
    type: "process_tree",
    ts: Date.now(),
    elapsed_ms: elapsed(),
    ps_output: psOutput,
    note: "captured immediately after iterator done",
  });

  // Check signal file immediately
  const immediateCheck = checkSignalFile();
  const fgCheck = checkFgMarker();
  emit({
    type: "signal_check",
    ts: Date.now(),
    elapsed_ms: elapsed(),
    file: SIGNAL_FILE,
    ...immediateCheck,
    fgMarker: fgCheck,
    note: "immediate check after iterator done",
  });

  // Mode-specific behavior
  if (MODE === "exit_immediate") {
    emit({
      type: "result",
      mode: MODE,
      elapsed_ms: elapsed(),
      messageCount,
      messageTypes,
      signalFile: SIGNAL_FILE,
      immediateSignalCheck: immediateCheck,
      fgMarkerCheck: fgCheck,
      note: "Exiting immediately. Outer test should check signal file after ~25s.",
    });
    process.exit(0);
  }

  if (MODE === "wait") {
    emit({
      type: "waiting",
      ts: Date.now(),
      elapsed_ms: elapsed(),
      waitDuration: 30000,
      note: "Waiting 30s for background task to complete...",
    });

    // Check every 5 seconds
    for (let i = 0; i < 6; i++) {
      await sleep(5000);
      const check = checkSignalFile();
      const ps = captureProcessTree();
      emit({
        type: "signal_check",
        ts: Date.now(),
        elapsed_ms: elapsed(),
        file: SIGNAL_FILE,
        ...check,
        note: `periodic check ${i + 1}/6`,
      });
      emit({
        type: "process_tree",
        ts: Date.now(),
        elapsed_ms: elapsed(),
        ps_output: ps,
        note: `periodic check ${i + 1}/6`,
      });

      if (check.exists) {
        emit({
          type: "result",
          mode: MODE,
          elapsed_ms: elapsed(),
          messageCount,
          messageTypes,
          signalFile: SIGNAL_FILE,
          signalFileFound: true,
          signalContents: check.contents,
          fgMarkerCheck: fgCheck,
          waitIteration: i + 1,
          note: "Background task completed during wait period!",
        });
        return;
      }
    }

    // Final check
    const finalCheck = checkSignalFile();
    emit({
      type: "result",
      mode: MODE,
      elapsed_ms: elapsed(),
      messageCount,
      messageTypes,
      signalFile: SIGNAL_FILE,
      signalFileFound: finalCheck.exists,
      signalContents: finalCheck.contents,
      fgMarkerCheck: fgCheck,
      note: finalCheck.exists
        ? "Background task completed after full wait"
        : "Background task did NOT complete after 30s wait",
    });
    return;
  }

  // MODE === "observe" - already consumed all messages above
  emit({
    type: "result",
    mode: MODE,
    elapsed_ms: elapsed(),
    messageCount,
    messageTypes,
    signalFile: SIGNAL_FILE,
    immediateSignalCheck: immediateCheck,
    fgMarkerCheck: fgCheck,
    note: "Observe mode complete. All messages cataloged.",
  });
}

function extractTextPreview(msg: Record<string, unknown>): string | null {
  try {
    const message = msg.message as Record<string, unknown>;
    const content = message?.content as Array<{ type: string; text?: string }>;
    const textBlock = content?.find((b) => b.type === "text");
    return textBlock?.text?.slice(0, 200) ?? null;
  } catch {
    return null;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    emit({
      type: "result",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
