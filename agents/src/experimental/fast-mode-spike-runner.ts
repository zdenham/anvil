/**
 * Minimal test runner to verify fast mode activation on SDK 0.2.59.
 *
 * Tests whether `fastMode: true` in `.claude/settings.json` activates
 * fast mode, and whether `fast_mode_state` is present on results.
 *
 * Environment variables:
 *   FAST_MODE      - "true" or "false" (default: "true")
 *   TEST_TOGGLE    - "true" to run a second query with toggled setting
 *   ANTHROPIC_API_KEY - required
 *
 * Stdout protocol (JSON lines):
 *   { "type": "message", ... }  - each streamed message with usage
 *   { "type": "result", ... }   - final result summary
 *   { "type": "done", ... }     - all queries complete
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FAST_MODE = process.env.FAST_MODE !== "false";
const TEST_TOGGLE = process.env.TEST_TOGGLE === "true";

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function writeSettings(dir: string, fastMode: boolean): void {
  const claudeDir = join(dir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({ fastMode }, null, 2),
  );
}

interface QueryResult {
  fastMode: boolean;
  messages: Record<string, unknown>[];
  finalFastModeState: unknown;
  finalUsage: unknown;
  sessionInfo: unknown;
}

async function runQuery(
  tempDir: string,
  fastMode: boolean,
): Promise<QueryResult> {
  writeSettings(tempDir, fastMode);

  const messages: Record<string, unknown>[] = [];
  let finalFastModeState: unknown = undefined;
  let finalUsage: unknown = undefined;
  let sessionInfo: unknown = undefined;

  const result = query({
    prompt: "Say hello in exactly 3 words. Do not use any tools.",
    options: {
      cwd: tempDir,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 1,
      betas: ["fast-mode-2026-02-01" as any],
      model: "claude-opus-4-6",
    },
  });

  for await (const message of result) {
    const msg: Record<string, unknown> = {
      type: "message",
      fastMode,
      messageType: (message as any).type,
    };

    // Capture usage object (may contain `speed` field)
    if ("usage" in (message as any)) {
      msg.usage = (message as any).usage;
    }

    // Capture fast_mode_state if present
    if ("fast_mode_state" in (message as any)) {
      msg.fast_mode_state = (message as any).fast_mode_state;
      finalFastModeState = (message as any).fast_mode_state;
    }

    // Capture session info if present
    if ("sessionInfo" in (message as any)) {
      const si = (message as any).sessionInfo;
      msg.sessionInfo = si;
      sessionInfo = si;
      if (si && "fast_mode_state" in si) {
        msg.sessionInfoFastModeState = si.fast_mode_state;
      }
    }

    // Check for result-level fields
    if ((message as any).type === "result") {
      finalUsage = (message as any).usage;
      if ("fast_mode_state" in (message as any)) {
        finalFastModeState = (message as any).fast_mode_state;
      }
    }

    messages.push(msg);
    emit(msg);
  }

  return { fastMode, messages, finalFastModeState, finalUsage, sessionInfo };
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "fast-mode-spike-"));

  try {
    const queries: QueryResult[] = [];

    // First query with the requested fast mode setting
    const q1 = await runQuery(tempDir, FAST_MODE);
    queries.push(q1);
    emit({
      type: "result",
      query: 1,
      fastMode: q1.fastMode,
      finalFastModeState: q1.finalFastModeState,
      finalUsage: q1.finalUsage,
      sessionInfo: q1.sessionInfo,
    });

    // Optional second query with toggled setting
    if (TEST_TOGGLE) {
      const q2 = await runQuery(tempDir, !FAST_MODE);
      queries.push(q2);
      emit({
        type: "result",
        query: 2,
        fastMode: q2.fastMode,
        finalFastModeState: q2.finalFastModeState,
        finalUsage: q2.finalUsage,
        sessionInfo: q2.sessionInfo,
      });
    }

    emit({
      type: "done",
      queriesRun: queries.length,
      summary: queries.map((q) => ({
        fastMode: q.fastMode,
        finalFastModeState: q.finalFastModeState,
        hadUsageSpeed: q.messages.some(
          (m) => (m.usage as any)?.speed !== undefined,
        ),
      })),
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
