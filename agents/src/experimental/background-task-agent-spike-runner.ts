/**
 * Background Task Agent Spike
 *
 * Tests whether the SDK iterator blocks for Task tool background agents
 * the same way it blocks for Bash background commands.
 *
 * The agent is asked to:
 *   1. Launch a background Task agent (run_in_background: true) that does a `sleep 15`
 *   2. Do a simple foreground action (write a marker file)
 *   3. Respond with "FOREGROUND_DONE"
 *
 * We measure whether the iterator stays open during the background agent's work.
 *
 * Stdout protocol (JSON lines):
 *   { type: "config", ... }
 *   { type: "message", ... }
 *   { type: "iterator_done", ... }
 *   { type: "signal_check", ... }
 *   { type: "result", ... }
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "fs";

const TIMESTAMP = Date.now();
const SIGNAL_FILE = `/tmp/bg-agent-spike-${TIMESTAMP}.txt`;
const FG_MARKER_FILE = `/tmp/bg-agent-spike-${TIMESTAMP}-fg.txt`;
const START = Date.now();

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function elapsed(): number {
  return Date.now() - START;
}

function checkFile(path: string): { exists: boolean; contents?: string } {
  const exists = existsSync(path);
  if (exists) {
    try {
      return { exists, contents: readFileSync(path, "utf-8").trim() };
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
    timestamp: TIMESTAMP,
    signalFile: SIGNAL_FILE,
    fgMarkerFile: FG_MARKER_FILE,
    pid: process.pid,
  });

  const prompt = [
    `You must do EXACTLY these three things in order:`,
    ``,
    `1. Use the Task tool with run_in_background set to true to launch a background agent.`,
    `   The task's prompt should be: "Use the Bash tool to run: sleep 15 && echo BACKGROUND_AGENT_DONE > ${SIGNAL_FILE}"`,
    `   Set subagent_type to "Bash" and description to "background sleep task"`,
    ``,
    `2. Use the Bash tool (foreground, NOT background) to run:`,
    `   echo "FOREGROUND_MARKER" > ${FG_MARKER_FILE}`,
    ``,
    `3. After both steps, respond with EXACTLY the text: FOREGROUND_DONE`,
    ``,
    `Do not use any other tools. Do not do anything else.`,
  ].join("\n");

  const result = query({
    prompt,
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 8,
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
        ...(msgType === "assistant" && {
          textPreview: extractTextPreview(msg),
        }),
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

  emit({
    type: "iterator_done",
    ts: Date.now(),
    elapsed_ms: elapsed(),
    messageCount,
    messageTypes,
  });

  // Check files immediately
  const signalCheck = checkFile(SIGNAL_FILE);
  const fgCheck = checkFile(FG_MARKER_FILE);

  emit({
    type: "signal_check",
    ts: Date.now(),
    elapsed_ms: elapsed(),
    signalFile: { path: SIGNAL_FILE, ...signalCheck },
    fgMarker: { path: FG_MARKER_FILE, ...fgCheck },
    note: "immediate check after iterator done",
  });

  // Wait 25s and check periodically
  for (let i = 0; i < 5; i++) {
    await sleep(5000);
    const check = checkFile(SIGNAL_FILE);
    emit({
      type: "signal_check",
      ts: Date.now(),
      elapsed_ms: elapsed(),
      signalFile: { path: SIGNAL_FILE, ...check },
      note: `periodic check ${i + 1}/5`,
    });
    if (check.exists) break;
  }

  const finalSignal = checkFile(SIGNAL_FILE);
  emit({
    type: "result",
    elapsed_ms: elapsed(),
    messageCount,
    messageTypes,
    signalFile: { path: SIGNAL_FILE, ...finalSignal },
    fgMarker: { path: FG_MARKER_FILE, ...fgCheck },
    iteratorBlockedForBackgroundAgent: signalCheck.exists,
    note: signalCheck.exists
      ? "Iterator DID block for background Task agent (same as Bash)"
      : finalSignal.exists
        ? "Iterator did NOT block, but agent completed during wait"
        : "Background Task agent did NOT complete even after wait",
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
