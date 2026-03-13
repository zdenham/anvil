/**
 * Unified terminal display name logic.
 * Used by tabs, sidebar, and content pane header.
 *
 * Priority:
 * 1. User-assigned label (isUserLabel === true)
 * 2. Last command from shell integration
 * 3. Auto-generated fallback label
 */
import type { TerminalSession } from "./types";

export function getTerminalDisplayName(session: TerminalSession): string {
  if (session.label && session.isUserLabel) return session.label;
  if (session.lastCommand) return session.lastCommand;
  return session.label ?? "Terminal";
}
