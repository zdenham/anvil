/**
 * Miscellaneous command dispatch.
 * Handles paths, repos, search, identity, shell, logging, process, etc.
 */

import { rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";
import { extractArg, extractOptArg } from "../helpers.js";
import {
  dataDirPath,
  configDirPath,
  homeDirPath,
} from "./paths.js";
import type { SidecarState } from "../state.js";

export async function dispatchMisc(
  cmd: string,
  args: Record<string, unknown>,
  state: SidecarState,
): Promise<unknown> {
  switch (cmd) {
    // ── Paths ──────────────────────────────────────────────────────────
    case "get_paths_info": {
      const suffix = process.env.ANVIL_APP_SUFFIX ?? "";
      return {
        data_dir: dataDirPath(),
        config_dir: configDirPath(),
        app_suffix: suffix,
        is_alternate_build: suffix !== "",
      };
    }

    case "get_agent_types":
      return ["research", "execution", "review", "merge"];

    // ── Repo ───────────────────────────────────────────────────────────
    case "validate_repository":
      return validateRepository(extractArg(args, "sourcePath"));

    case "remove_repository_data":
      return removeRepositoryData(
        extractArg(args, "repoSlug"),
        extractArg(args, "anvilDir"),
      );

    default:
      return dispatchMiscPart2(cmd, args, state);
  }
}

async function dispatchMiscPart2(
  cmd: string,
  args: Record<string, unknown>,
  state: SidecarState,
): Promise<unknown> {
  switch (cmd) {
    // ── Search ─────────────────────────────────────────────────────────
    case "search_threads":
      return searchThreads(
        extractArg(args, "anvilDir"),
        extractArg(args, "query"),
        extractOptArg(args, "maxResults"),
        extractOptArg(args, "caseSensitive"),
      );

    // ── Identity ───────────────────────────────────────────────────────
    case "get_github_handle":
      return getGithubHandle();

    // ── Shell ──────────────────────────────────────────────────────────
    case "initialize_shell_environment":
      return initializeShellEnv(state);

    case "is_shell_initialized":
      return state.shellInitialized;

    case "check_documents_access":
      return checkDocumentsAccess();

    case "get_shell_path":
      return state.shellPath;

    default:
      return dispatchMiscPart3(cmd, args, state);
  }
}

async function dispatchMiscPart3(
  cmd: string,
  args: Record<string, unknown>,
  state: SidecarState,
): Promise<unknown> {
  switch (cmd) {
    // ── Logging ────────────────────────────────────────────────────────
    case "web_log": {
      const entry = toRawLogEntry(
        extractArg(args, "level"),
        extractArg(args, "message"),
        extractOptArg(args, "source") ?? "web",
      );
      state.logBuffer.push(entry);
      state.broadcaster.broadcast("log-event", entry);
      return null;
    }

    case "web_log_batch": {
      const entries = extractArg<
        { level: string; message: string; source?: string }[]
      >(args, "entries");
      for (const e of entries) {
        const entry = toRawLogEntry(
          e.level,
          e.message,
          e.source ?? "web",
        );
        state.logBuffer.push(entry);
        state.broadcaster.broadcast("log-event", entry);
      }
      return null;
    }

    case "get_buffered_logs": {
      const logs = [...state.logBuffer];
      return logs;
    }

    case "clear_logs":
      state.logBuffer.length = 0;
      return null;

    case "run_internal_update":
      // Placeholder — runs update script if available
      return null;

    // ── Process ────────────────────────────────────────────────────────
    case "kill_process":
      return killProcess(extractArg(args, "pid"));

    case "get_process_memory":
      return { rss: process.memoryUsage().rss };

    case "write_memory_snapshot": {
      const snapshotJson = extractArg<string>(args, "snapshotJson");
      const { writeFile, mkdir } = await import("node:fs/promises");
      const logsDir = join(configDirPath(), "logs");
      await mkdir(logsDir, { recursive: true });
      const filename = `memory-${Date.now()}.json`;
      await writeFile(join(logsDir, filename), snapshotJson);
      return filename;
    }

    // ── Diagnostics ────────────────────────────────────────────────────
    case "update_diagnostic_config":
      Object.assign(state.diagnosticConfig, args);
      return null;

    // ── Agent Hub (delegated) ──────────────────────────────────────────
    case "list_connected_agents":
      return state.agentHub.list();

    case "send_to_agent": {
      const threadId = extractArg<string>(args, "threadId");
      const message = extractArg<string>(args, "message");
      state.agentHub.sendToAgent(threadId, message);
      return null;
    }

    case "get_agent_socket_path":
      // Return WS URL instead of socket path
      return `ws://127.0.0.1:${process.env.ANVIL_WS_PORT ?? "9600"}/ws/agent`;

    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

// ── Implementation helpers ─────────────────────────────────────────────

function validateRepository(
  sourcePath: string,
): { exists: boolean; is_git_repo: boolean; error: string | null } {
  const exists = existsSync(sourcePath);
  if (!exists) {
    return { exists: false, is_git_repo: false, error: "Path does not exist" };
  }
  const isGitRepo =
    existsSync(join(sourcePath, ".git")) ||
    existsSync(join(sourcePath, "HEAD"));
  return { exists, is_git_repo: isGitRepo, error: null };
}

async function removeRepositoryData(
  repoSlug: string,
  anvilDir: string,
): Promise<null> {
  await rm(join(anvilDir, "repositories", repoSlug), {
    recursive: true,
    force: true,
  });
  return null;
}

async function searchThreads(
  anvilDir: string,
  query: string,
  maxResults?: number,
  caseSensitive?: boolean,
): Promise<{ matches: unknown[]; truncated: boolean }> {
  const max = maxResults ?? 100;
  const threadsDir = join(anvilDir, "threads");
  const matches: {
    threadId: string;
    lineContent: string;
    matchIndex: number;
  }[] = [];

  try {
    const grepArgs = ["-r", "-F"];
    if (!caseSensitive) grepArgs.push("-i");
    grepArgs.push("-l", "--include=state.json", query, threadsDir);

    const { execFileSync } = await import("node:child_process");
    const files = execFileSync("grep", grepArgs, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    for (const file of files) {
      if (matches.length >= max) break;

      // Extract thread ID from path
      const parts = file.split("/");
      const threadsIdx = parts.indexOf("threads");
      if (threadsIdx < 0 || threadsIdx + 1 >= parts.length) continue;
      const threadId = parts[threadsIdx + 1];

      try {
        const lineArgs = ["-F", "-n"];
        if (!caseSensitive) lineArgs.push("-i");
        lineArgs.push(query, file);
        const lineOutput = execFileSync("grep", lineArgs, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
        });

        for (const line of lineOutput.split("\n").filter(Boolean)) {
          if (matches.length >= max) break;
          const colonIdx = line.indexOf(":");
          const content = line.slice(colonIdx + 1).trim();
          // Clean JSON snippets
          const cleaned = content
            .replace(/^"[^"]*":\s*"/, "")
            .replace(/",?\s*$/, "")
            .slice(0, 200);

          matches.push({
            threadId,
            lineContent: cleaned,
            matchIndex: matches.length,
          });
        }
      } catch {
        // grep returns non-zero if no matches in individual file
      }
    }
  } catch {
    // grep returns non-zero if no matches at all
  }

  return { matches, truncated: matches.length >= max };
}

function getGithubHandle(): string | null {
  try {
    return execFileSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim() || null;
  } catch {
    return null;
  }
}

function initializeShellEnv(state: SidecarState): boolean {
  const shell = process.env.SHELL ?? "/bin/zsh";

  // Check Documents access
  checkDocumentsAccess();

  try {
    const path = execSync(`${shell} -i -l -c "echo $PATH"`, {
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();

    if (path) {
      state.shellPath = path;
      state.shellInitialized = true;
      return true;
    }
  } catch {
    // Shell initialization failed
  }

  state.shellInitialized = true; // Mark as attempted
  return false;
}

function checkDocumentsAccess(): boolean {
  const documentsDir = join(homeDirPath(), "Documents");
  try {
    readdirSync(documentsDir);
    return true;
  } catch {
    return false;
  }
}

async function killProcess(pid: number): Promise<boolean> {
  try {
    // Try group kill first
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

/** Convert web log args to the RawLogEntry format the frontend expects. */
function toRawLogEntry(
  level: string,
  message: string,
  source: string,
): { timestamp: string; level: string; target: string; message: string } {
  return {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    target: source,
    message,
  };
}
