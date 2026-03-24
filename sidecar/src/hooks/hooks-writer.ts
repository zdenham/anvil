/**
 * Dynamic hooks.json writer for the Anvil plugin.
 *
 * Called by the sidecar on startup to write ~/.anvil/hooks/hooks.json
 * with the actual port baked into hook URLs. $ANVIL_THREAD_ID remains
 * as an env var since it varies per PTY session.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface HttpHook {
  type: "http";
  url: string;
  headers: Record<string, string>;
  allowedEnvVars: string[];
  timeout: number;
  statusMessage?: string;
}

interface HookMatcher {
  hooks: HttpHook[];
}

interface HooksConfig {
  UserPromptSubmit: HookMatcher[];
  SessionStart: HookMatcher[];
  PreToolUse: HookMatcher[];
  PostToolUse: HookMatcher[];
  Stop: HookMatcher[];
}

function buildHook(baseUrl: string, path: string, statusMessage?: string): HttpHook {
  return {
    type: "http",
    url: `${baseUrl}/hooks/${path}`,
    headers: { "X-Anvil-Thread-Id": "$ANVIL_THREAD_ID" },
    allowedEnvVars: ["ANVIL_THREAD_ID"],
    timeout: 10,
    ...(statusMessage ? { statusMessage } : {}),
  };
}

export function buildHooksConfig(baseUrl: string): HooksConfig {
  return {
    UserPromptSubmit: [{ hooks: [buildHook(baseUrl, "user-prompt-submit", "Connecting to Anvil...")] }],
    SessionStart: [{ hooks: [buildHook(baseUrl, "session-start", "Connecting to Anvil...")] }],
    PreToolUse: [{ hooks: [buildHook(baseUrl, "pre-tool-use", "Checking with Anvil...")] }],
    PostToolUse: [{ hooks: [buildHook(baseUrl, "post-tool-use")] }],
    Stop: [{ hooks: [buildHook(baseUrl, "stop")] }],
  };
}

/**
 * Write hooks.json to the Anvil plugin directory.
 * Called after the sidecar binds its port.
 */
export function writeHooksJson(anvilDir: string, port: number): void {
  const hooksDir = join(anvilDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const baseUrl = `http://localhost:${port}`;
  const config = buildHooksConfig(baseUrl);

  writeFileSync(
    join(hooksDir, "hooks.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}
