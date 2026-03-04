/**
 * Minimal test runner to verify fast mode activation on SDK 0.2.64.
 *
 * Tests whether `fastMode: true` activates fast mode. Tries two
 * mechanisms: (1) writing to `.claude/settings.json` and (2) passing
 * settings directly via the `settings` option on `query()`.
 *
 * Uses the real project directory so the SDK subprocess has a valid
 * environment. Writes/restores `.claude/settings.json` to control
 * the fastMode setting.
 *
 * Environment variables:
 *   FAST_MODE          - "true" or "false" (default: "true")
 *   TEST_TOGGLE        - "true" to run a second query with toggled setting
 *   USE_INLINE_SETTINGS - "true" to pass fastMode via settings option instead of file
 *   PROJECT_ROOT       - project root path (required)
 *   ANTHROPIC_API_KEY  - required
 *
 * Stdout protocol (JSON lines):
 *   { "type": "message", ... }  - each streamed message with usage
 *   { "type": "result", ... }   - final result summary
 *   { "type": "done", ... }     - all queries complete
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FAST_MODE = process.env.FAST_MODE !== "false";
const TEST_TOGGLE = process.env.TEST_TOGGLE === "true";
const USE_INLINE_SETTINGS = process.env.USE_INLINE_SETTINGS === "true";
const PROJECT_ROOT = process.env.PROJECT_ROOT;

if (!PROJECT_ROOT) {
  throw new Error("PROJECT_ROOT env var is required");
}

const SETTINGS_PATH = join(PROJECT_ROOT, ".claude", "settings.json");

function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function readSettings(): string {
  try {
    return readFileSync(SETTINGS_PATH, "utf-8");
  } catch {
    return "{}";
  }
}

function writeSettings(fastMode: boolean): void {
  const current = JSON.parse(readSettings());
  current.fastMode = fastMode;
  writeFileSync(SETTINGS_PATH, JSON.stringify(current, null, 2));
}

interface QueryResult {
  fastMode: boolean;
  messages: Record<string, unknown>[];
  finalFastModeState: unknown;
  finalUsage: unknown;
  sessionInfo: unknown;
}

async function runQuery(fastMode: boolean): Promise<QueryResult> {
  writeSettings(fastMode);

  const messages: Record<string, unknown>[] = [];
  let finalFastModeState: unknown = undefined;
  let finalUsage: unknown = undefined;
  let sessionInfo: unknown = undefined;

  // Strip env vars that cause "nested session" errors when running inside Claude Code
  const cleanEnv = { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined };

  const options: Record<string, unknown> = {
    env: cleanEnv,
    cwd: PROJECT_ROOT,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 1,
    settingSources: ["user", "project"],
    betas: ["fast-mode-2026-02-01" as any],
    model: "claude-opus-4-6",
  };

  if (USE_INLINE_SETTINGS) {
    options.settings = { fastMode: fastMode };
  }

  const result = query({
    prompt: "Say hello in exactly 3 words. Do not use any tools.",
    options: options as any,
  });

  for await (const message of result) {
    const msg: Record<string, unknown> = {
      type: "message",
      fastMode,
      messageType: (message as any).type,
    };

    // Dump all top-level keys for observation
    for (const key of Object.keys(message as any)) {
      if (key !== "type") {
        msg[key] = (message as any)[key];
      }
    }

    // Specifically track fast_mode_state
    if ("fast_mode_state" in (message as any)) {
      finalFastModeState = (message as any).fast_mode_state;
    }

    // Specifically track session info
    if ("sessionInfo" in (message as any)) {
      sessionInfo = (message as any).sessionInfo;
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
  // Save original settings to restore later
  const originalSettings = readSettings();

  try {
    const queries: QueryResult[] = [];

    const q1 = await runQuery(FAST_MODE);
    queries.push(q1);
    emit({
      type: "result",
      query: 1,
      fastMode: q1.fastMode,
      finalFastModeState: q1.finalFastModeState,
      finalUsage: q1.finalUsage,
      sessionInfo: q1.sessionInfo,
    });

    if (TEST_TOGGLE) {
      const q2 = await runQuery(!FAST_MODE);
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
    // Restore original settings
    writeFileSync(SETTINGS_PATH, originalSettings);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    // Still restore settings on error
    try {
      const original = readSettings();
      if (original) writeFileSync(SETTINGS_PATH, original);
    } catch { /* best effort */ }
    process.exit(1);
  });
