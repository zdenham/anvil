/**
 * Shared server state, passed to all dispatch handlers.
 *
 * Mirrors the Rust WsState struct.
 */

import { EventBroadcaster } from "./push.js";
import { LockManager } from "./managers/lock-manager.js";
import { AgentProcessManager } from "./managers/agent-process-manager.js";
import { AgentHub } from "./managers/agent-hub.js";
import { TerminalManager } from "./managers/terminal-manager.js";
import { FileWatcherManager } from "./managers/file-watcher-manager.js";
import { createLogger } from "./logger.js";

export interface SidecarState {
  broadcaster: EventBroadcaster;
  lockManager: LockManager;
  agentProcesses: AgentProcessManager;
  agentHub: AgentHub;
  terminalManager: TerminalManager;
  fileWatcherManager: FileWatcherManager;
  /** Cached shell PATH from login shell initialization. */
  shellPath: string;
  shellInitialized: boolean;
  /** In-memory log buffer for web_log / get_buffered_logs. */
  logBuffer: LogEntry[];
  /** Diagnostic logging config. */
  diagnosticConfig: DiagnosticConfig;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  target: string;
  message: string;
}

export interface DiagnosticConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export function createState(): SidecarState {
  const broadcaster = new EventBroadcaster();
  const logBuffer: LogEntry[] = [];

  // Create a temporary state-like object for the logger (it only reads
  // logBuffer and broadcaster), then assign agentHub after.
  const partialState = { broadcaster, logBuffer } as SidecarState;
  const agentLogger = createLogger(partialState);

  const state: SidecarState = {
    broadcaster,
    lockManager: new LockManager(),
    agentProcesses: new AgentProcessManager(),
    agentHub: new AgentHub(broadcaster, agentLogger),
    terminalManager: new TerminalManager(),
    fileWatcherManager: new FileWatcherManager(),
    shellPath: process.env.PATH ?? "",
    shellInitialized: false,
    logBuffer,
    diagnosticConfig: { enabled: false },
  };
  return state;
}
