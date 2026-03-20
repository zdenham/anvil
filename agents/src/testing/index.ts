// Types
export type {
  AgentRunOutput,
  AgentTestOptions,
  QueuedMessageSpec,
  ThreadState,
  FileChange,
  ResultMetrics,
  AgentThreadStatus,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  StdoutMessage,
} from "./types.js";

// Harness
export { AgentTestHarness } from "./agent-harness.js";
export type { AgentTestHarnessOptions } from "./agent-harness.js";

// Runner Config
export { defaultRunnerConfig, createRunnerConfig } from "./runner-config.js";
export type { RunnerConfig } from "./runner-config.js";

// Assertions
export {
  AgentAssertions,
  assertAgent,
  // Socket-based assertion helpers
  assertReceivedState,
  assertReceivedEvent,
  assertReceivedRegistration,
  assertReceivedEventsInOrder,
  getFinalState,
  getEvents,
} from "./assertions.js";

// Services
export {
  TestMortDirectory,
  TestRepository,
} from "./services/index.js";
export type {
  TestMortDirectoryOptions,
  TestRepositoryOptions,
  FileFixture,
} from "./services/index.js";

// Mock LLM
export {
  MOCK_LLM_VAR,
  createMockScript,
  cleanupMockScript,
  MockScripts,
} from "./mock-llm.js";
export type {
  MockScript,
  MockResponse,
  MockToolCall,
} from "./mock-llm.js";

// Mock Client (for advanced usage)
export { MockClaudeClient } from "./mock-claude-client.js";
export type { ContentBlock } from "./mock-claude-client.js";
// SDK types re-exported for consumers
export type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
  TextBlock,
  ToolUseBlock,
} from "./mock-claude-client.js";

// Mock Query
export {
  isMockModeEnabled,
  getMockScriptPath,
  mockQuery,
} from "./mock-query.js";
export type { ToolExecutor, MockQueryOptions } from "./mock-query.js";

// Mock Hub Server (for WebSocket IPC testing)
export { MockHubServer } from "./mock-hub-server.js";
