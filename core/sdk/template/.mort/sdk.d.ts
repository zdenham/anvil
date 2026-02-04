// ═══════════════════════════════════════════════════════════════════
// Context passed to quick action scripts
// ═══════════════════════════════════════════════════════════════════

export interface QuickActionExecutionContext {
  contextType: 'thread' | 'plan' | 'empty';
  threadId?: string;
  planId?: string;
  repository: {
    id: string;
    name: string;
    path: string;
  } | null;
  worktree: {
    id: string;
    path: string;
    branch: string | null;
  } | null;
  threadState?: {
    status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
    messageCount: number;
    fileChanges: Array<{ path: string; operation: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// SDK Services
// ═══════════════════════════════════════════════════════════════════

export interface MortSDK {
  git: GitService;
  threads: ThreadService;
  plans: PlanService;
  ui: UIService;
  log: LogService;
}

export interface GitService {
  getCurrentBranch(worktreePath: string): Promise<string | null>;
  getDefaultBranch(repoPath: string): Promise<string>;
  getHeadCommit(repoPath: string): Promise<string>;
  branchExists(repoPath: string, branch: string): Promise<boolean>;
  listBranches(repoPath: string): Promise<string[]>;
  getDiff(repoPath: string, baseCommit: string): Promise<string>;
}

export interface ThreadService {
  get(threadId: string): Promise<ThreadInfo | null>;
  list(): Promise<ThreadInfo[]>;
  getByRepo(repoId: string): Promise<ThreadInfo[]>;
  getUnread(): Promise<ThreadInfo[]>;
  archive(threadId: string): Promise<void>;
  markRead(threadId: string): Promise<void>;
  markUnread(threadId: string): Promise<void>;
}

export interface ThreadInfo {
  id: string;
  repoId: string;
  worktreeId: string;
  status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  isRead: boolean;
  turnCount: number;
}

export interface PlanService {
  get(planId: string): Promise<PlanInfo | null>;
  list(): Promise<PlanInfo[]>;
  getByRepo(repoId: string): Promise<PlanInfo[]>;
  readContent(planId: string): Promise<string>;
  archive(planId: string): Promise<void>;
}

export interface PlanInfo {
  id: string;
  repoId: string;
  worktreeId: string;
  relativePath: string;
  isRead: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UIService {
  setInputContent(content: string): Promise<void>;
  appendInputContent(content: string): Promise<void>;
  clearInput(): Promise<void>;
  focusInput(): Promise<void>;
  navigateToThread(threadId: string): Promise<void>;
  navigateToPlan(planId: string): Promise<void>;
  navigateToNextUnread(): Promise<void>;
  showToast(message: string, type?: 'info' | 'success' | 'error'): Promise<void>;
  closePanel(): Promise<void>;
}

export interface LogService {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

// ═══════════════════════════════════════════════════════════════════
// Quick Action Definition
// ═══════════════════════════════════════════════════════════════════

export type QuickActionFn = (
  context: QuickActionExecutionContext,
  sdk: MortSDK
) => Promise<void> | void;

export interface QuickActionDefinition {
  id: string;
  title: string;
  description?: string;
  contexts: ('thread' | 'plan' | 'empty' | 'all')[];
  execute: QuickActionFn;
}

export function defineAction(def: QuickActionDefinition): QuickActionDefinition;
