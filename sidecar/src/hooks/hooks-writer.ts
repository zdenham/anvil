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

function buildHook(baseUrl: string, path: string, authHeader: string | null, statusMessage?: string): HttpHook {
  const headers: Record<string, string> = { "X-Anvil-Thread-Id": "$ANVIL_THREAD_ID" };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }
  return {
    type: "http",
    url: `${baseUrl}/hooks/${path}`,
    headers,
    allowedEnvVars: ["ANVIL_THREAD_ID"],
    timeout: 10,
    ...(statusMessage ? { statusMessage } : {}),
  };
}

export function buildHooksConfig(baseUrl: string, authHeader: string | null = null): HooksConfig {
  return {
    UserPromptSubmit: [{ hooks: [buildHook(baseUrl, "user-prompt-submit", authHeader, "Connecting to Anvil...")] }],
    SessionStart: [{ hooks: [buildHook(baseUrl, "session-start", authHeader, "Connecting to Anvil...")] }],
    PreToolUse: [{ hooks: [buildHook(baseUrl, "pre-tool-use", authHeader, "Checking with Anvil...")] }],
    PostToolUse: [{ hooks: [buildHook(baseUrl, "post-tool-use", authHeader)] }],
    Stop: [{ hooks: [buildHook(baseUrl, "stop", authHeader)] }],
  };
}

/**
 * Write hooks.json to the Anvil plugin directory.
 * Called after the sidecar binds its port.
 */
export function writeHooksJson(anvilDir: string, port: number, token?: string): void {
  const hooksDir = join(anvilDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const baseUrl = `http://localhost:${port}`;
  const authHeader = token ? `Bearer ${token}` : null;
  const config = buildHooksConfig(baseUrl, authHeader);

  writeFileSync(
    join(hooksDir, "hooks.json"),
    JSON.stringify({ hooks: config }, null, 2) + "\n",
  );
}
