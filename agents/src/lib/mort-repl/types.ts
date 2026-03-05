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

export interface SpawnOptions {
  prompt: string;
  agentType?: string;
  cwd?: string;
  permissionMode?: string;
}
