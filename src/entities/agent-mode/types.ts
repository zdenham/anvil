import type { AgentMode } from "@core/types/agent-mode.js";

// Re-export for convenience
export type { AgentMode };

/** Ordered modes for cycling with Shift+Tab */
export const AGENT_MODE_ORDER: readonly AgentMode[] = [
  "normal",
  "plan",
  "auto-accept",
] as const;

export interface AgentModeConfig {
  label: string;
  shortLabel: string;
  description: string;
  /** CSS classes for the indicator */
  className: string;
}

export const AGENT_MODE_CONFIG: Record<AgentMode, AgentModeConfig> = {
  normal: {
    label: "Normal Mode",
    shortLabel: "Normal",
    description: "Requires approval for file edits",
    className: "text-surface-400 bg-surface-700",
  },
  plan: {
    label: "Plan Mode",
    shortLabel: "Plan",
    description: "Agent plans but does not execute",
    className: "text-secondary-400 bg-secondary-500/15",
  },
  "auto-accept": {
    label: "Auto-Accept Mode",
    shortLabel: "Auto",
    description: "Auto-approves file edits",
    className: "text-success-400 bg-success-500/15",
  },
};

/** Get the next mode in the cycle */
export function getNextMode(current: AgentMode): AgentMode {
  const currentIndex = AGENT_MODE_ORDER.indexOf(current);
  const nextIndex = (currentIndex + 1) % AGENT_MODE_ORDER.length;
  return AGENT_MODE_ORDER[nextIndex];
}
