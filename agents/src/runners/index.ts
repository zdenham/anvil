/**
 * Runner types and strategy interface for the unified runner architecture.
 *
 * This module provides the core types that enable a single entry point to handle
 * both task-based agents (research, execution, merge) and simple agents through
 * a common interface.
 */

export type {
  AgentType,
  RunnerConfig,
  OrchestrationContext,
  RunnerStrategy,
} from "./types.js";

export {
  emitLog,
  emitEvent,
  buildSystemPrompt,
  setupSignalHandlers,
  runAgentLoop,
  type AgentLoopOptions,
} from "./shared.js";

export { SimpleRunnerStrategy } from "./simple-runner-strategy.js";

export { TaskRunnerStrategy } from "./task-runner-strategy.js";
