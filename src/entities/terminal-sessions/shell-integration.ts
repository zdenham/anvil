/**
 * Shell integration for terminal command tracking.
 * Writes a zsh .zshenv script to ~/.mort/shell-integration/zsh/
 * that emits OSC 7727 escape sequences on each command execution.
 */
import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";

const SHELL_INTEGRATION_DIR = "shell-integration/zsh";
const ZSHENV_PATH = `${SHELL_INTEGRATION_DIR}/.zshenv`;

/**
 * Zsh shell integration script.
 * 1. Restores original ZDOTDIR so user config loads normally
 * 2. Sources the user's real .zshenv
 * 3. Adds a preexec hook that emits OSC 7727 with the command text
 */
const ZSHENV_CONTENT = `# Mort shell integration for zsh
# Restores original ZDOTDIR so user config loads normally,
# then adds a minimal preexec hook for command tracking.

# 1. Restore original ZDOTDIR
if [[ -n "$MORT_ORIGINAL_ZDOTDIR" ]]; then
  ZDOTDIR="$MORT_ORIGINAL_ZDOTDIR"
  unset MORT_ORIGINAL_ZDOTDIR
else
  unset ZDOTDIR
fi

# 2. Source the user's real .zshenv (if it exists)
[[ -f "\${ZDOTDIR:-$HOME}/.zshenv" ]] && source "\${ZDOTDIR:-$HOME}/.zshenv"

# 3. Add preexec hook — emits OSC 7727 with the command text
__mort_preexec() { printf '\\e]7727;cmd;%s\\a' "$1"; }
preexec_functions+=(__mort_preexec)
`;

/**
 * Writes the zsh shell integration script if missing or outdated.
 * Called lazily from terminal create().
 */
export async function ensureShellIntegration(): Promise<void> {
  try {
    const existing = await appData.readText(ZSHENV_PATH);
    if (existing === ZSHENV_CONTENT) return;

    await appData.ensureDir(SHELL_INTEGRATION_DIR);
    await appData.writeText(ZSHENV_PATH, ZSHENV_CONTENT);
    logger.info("[ShellIntegration] Wrote zsh integration script");
  } catch (err) {
    logger.error("[ShellIntegration] Failed to write zsh integration", { err });
  }
}
