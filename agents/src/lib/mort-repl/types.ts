export interface ReplContext {
  threadId: string;
  repoId: string;
  worktreeId: string;
  workingDir: string;
  permissionModeId: string;
  mortDir: string;
}

export interface ReplResult {
  success: boolean;
  value: unknown;
  logs: string[];
  error?: string;
  durationMs: number;
}

export interface ContextShortCircuit {
  /** Percentage of context window (0-100) at which to start nudging */
  limitPercent: number;
  /** Message injected as additionalContext each turn after the limit is reached */
  message: string;
}

export interface SpawnOptions {
  prompt: string;
  contextShortCircuit?: ContextShortCircuit;
  /** Wall-clock timeout in ms. Default 600_000 (10 min). SIGTERM then SIGKILL after 5s. */
  timeoutMs?: number;
}
