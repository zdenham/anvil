/**
 * Runner types and strategy interface for the unified runner architecture.
 */

export type {
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
