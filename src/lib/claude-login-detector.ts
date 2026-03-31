import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger-client";
import { fsCommands } from "@/lib/tauri-commands";

export interface ClaudeLoginStatus {
  detected: boolean;
  source?: "keychain" | "credentials-file";
}

/**
 * Probes for existing `claude login` credentials.
 * Does NOT extract or store the token — just checks existence.
 * The actual auth happens inside the Claude Code CLI subprocess.
 */
export async function detectClaudeLogin(): Promise<ClaudeLoginStatus> {
  // macOS Keychain probe — service name changed across Claude versions
  const keychainServices = ["Claude Code-credentials", "Claude Code"];
  for (const service of keychainServices) {
    try {
      const cmd = Command.create("security", [
        "find-generic-password",
        "-s", service,
        "-w",
      ]);
      const output = await cmd.execute();
      if (output.code === 0 && output.stdout.trim().length > 0) {
        return { detected: true, source: "keychain" };
      }
    } catch {
      // Keychain entry not found or access denied — try next
    }
  }

  // Fallback: check ~/.claude/.credentials.json existence
  try {
    const home = await fsCommands.getHomeDir();
    const credPath = `${home}/.claude/.credentials.json`;
    const exists = await invoke<boolean>("fs_exists", { path: credPath });
    if (exists) {
      return { detected: true, source: "credentials-file" };
    }
  } catch (err) {
    logger.debug("[claude-login-detector] Failed to check credentials file:", err);
  }

  return { detected: false };
}
