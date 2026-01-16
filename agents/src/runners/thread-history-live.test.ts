/**
 * Thread History Live Integration Test
 *
 * This test uses a REAL LLM (no mocks) to verify that conversation context
 * is properly passed when resuming a thread. This is the definitive test
 * for the thread history bug.
 *
 * IMPORTANT: This test requires an ANTHROPIC_API_KEY environment variable.
 * Run with: cd agents && pnpm test thread-history-live.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

// Track calls to output functions
const mockCalls = {
  initState: [] as Array<unknown>,
  appendUserMessage: [] as Array<string>,
  appendAssistantMessage: [] as Array<MessageParam>,
  complete: [] as Array<unknown>,
  markToolRunning: [] as Array<{ toolUseId: string; toolName: string }>,
  markToolComplete: [] as Array<{ toolUseId: string; result: string; isError: boolean }>,
};

// Capture the actual state written to disk
let capturedState: {
  messages: MessageParam[];
  status: string;
  [key: string]: unknown;
} | null = null;

let actualStatePath = "";

// Mock output module to capture state without blocking
vi.mock("../output.js", () => {
  const { writeFileSync } = require("fs");
  const { join } = require("path");

  let statePath = "";
  let state: {
    messages: MessageParam[];
    fileChanges: unknown[];
    workingDirectory: string;
    status: string;
    timestamp: number;
    toolStates: Record<string, unknown>;
    sessionId?: string;
  };

  return {
    initState: vi.fn(async (threadPath: string, workingDirectory: string, priorMessages: MessageParam[] = []) => {
      statePath = join(threadPath, "state.json");
      actualStatePath = statePath;
      state = {
        messages: priorMessages,
        fileChanges: [],
        workingDirectory,
        status: "running",
        timestamp: Date.now(),
        toolStates: {},
      };
      mockCalls.initState.push({ threadPath, workingDirectory, priorMessages });
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    }),
    appendUserMessage: vi.fn(async (content: string) => {
      state.messages.push({ role: "user", content });
      state.timestamp = Date.now();
      mockCalls.appendUserMessage.push(content);
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    }),
    appendAssistantMessage: vi.fn(async (message: MessageParam) => {
      state.messages.push(message);
      state.timestamp = Date.now();
      mockCalls.appendAssistantMessage.push(message);
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      capturedState = { ...state };
    }),
    markToolRunning: vi.fn(async (toolUseId: string, toolName: string) => {
      state.toolStates[toolUseId] = { status: "running", toolName };
      mockCalls.markToolRunning.push({ toolUseId, toolName });
    }),
    markToolComplete: vi.fn(async (toolUseId: string, result: string, isError: boolean) => {
      state.toolStates[toolUseId] = { status: isError ? "error" : "complete", result, isError };
      mockCalls.markToolComplete.push({ toolUseId, result, isError });
    }),
    complete: vi.fn(async (metrics: unknown) => {
      state.status = "complete";
      state.timestamp = Date.now();
      mockCalls.complete.push(metrics);
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      capturedState = { ...state };
    }),
    setSessionId: vi.fn(async (sessionId: string) => {
      state.sessionId = sessionId;
      state.timestamp = Date.now();
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    }),
    relayEventsFromToolOutput: vi.fn(),
  };
});

// Mock the logger (keep it quiet during tests)
vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  stdout: vi.fn(),
}));

// Import after mocks
import { runAgentLoop } from "./shared.js";
import type { RunnerConfig, OrchestrationContext } from "./types.js";
import type { AgentConfig } from "../agent-types/index.js";

describe("Thread History - Live Multi-Turn Test", () => {
  let testDir: string;
  let threadPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `thread-history-live-${randomUUID()}`);
    threadPath = join(testDir, "thread");
    mkdirSync(threadPath, { recursive: true });

    // Reset captures
    mockCalls.initState = [];
    mockCalls.appendUserMessage = [];
    mockCalls.appendAssistantMessage = [];
    mockCalls.complete = [];
    mockCalls.markToolRunning = [];
    mockCalls.markToolComplete = [];
    capturedState = null;
    actualStatePath = "";
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * CRITICAL TEST: This test verifies the agent has conversation context
   * when resuming a thread, using a real LLM (no mocks).
   *
   * Test flow:
   * 1. Send a message with a unique UUID
   * 2. Agent acknowledges
   * 3. Resume thread and ask "what was the code I gave you?"
   * 4. Verify response contains the UUID
   *
   * If this test FAILS, the thread history bug is confirmed.
   * If this test PASSES, the bug may be elsewhere (UI, timing, etc.)
   */
  it("agent should remember UUID from previous turn (LIVE LLM)", async () => {
    // Skip if no API key (CI environments may not have one)
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log("Skipping live test: ANTHROPIC_API_KEY not set");
      return;
    }
    // Set the standard key for the SDK
    process.env.ANTHROPIC_API_KEY = apiKey;

    const testUuid = randomUUID();
    console.log(`[TEST] Using test UUID: ${testUuid}`);

    // === TURN 1: Send UUID to agent ===
    const config1: RunnerConfig = {
      prompt: `Remember this exact code: ${testUuid}. Reply with only "Acknowledged, I will remember the code." and nothing else.`,
      mortDir: testDir,
      agent: "simple",
      threadId: "test-thread-1",
    };

    const context1: OrchestrationContext = {
      workingDir: testDir,
      threadPath,
      threadId: "test-thread-1",
    };

    // Use haiku for speed and cost efficiency
    const agentConfig: AgentConfig = {
      agentType: "simple",
      model: "claude-opus-4-5-20251101",
      appendedPrompt: "You are a helpful assistant. Follow instructions exactly.",
      tools: { type: "preset", preset: "claude_code" },
    };

    console.log("[TEST] Running Turn 1 (send UUID)...");
    // Turn 1: no prior messages
    await runAgentLoop(config1, context1, agentConfig, { messages: [] });

    // Verify turn 1 completed
    expect(mockCalls.appendAssistantMessage.length).toBeGreaterThan(0);
    console.log(`[TEST] Turn 1 completed. Messages: ${mockCalls.appendUserMessage.length} user, ${mockCalls.appendAssistantMessage.length} assistant`);

    // Read the state.json to get session ID for turn 2
    const stateJsonPath = join(threadPath, "state.json");
    expect(existsSync(stateJsonPath)).toBe(true);

    const stateContent = readFileSync(stateJsonPath, "utf-8");
    const turn1State = JSON.parse(stateContent);
    const priorMessages: MessageParam[] = turn1State.messages;

    console.log(`[TEST] Prior messages from turn 1: ${priorMessages.length}`);
    console.log(`[TEST] Prior message roles: ${priorMessages.map(m => m.role).join(", ")}`);
    console.log(`[TEST] Prior messages content preview:`);
    for (const msg of priorMessages) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      console.log(`  [${msg.role}]: ${content.slice(0, 100)}...`);
    }

    // Verify we have prior messages (should have user + assistant from turn 1)
    expect(priorMessages.length).toBeGreaterThanOrEqual(2);

    // === TURN 2: Ask about the UUID ===
    // Reset mock calls for turn 2
    mockCalls.appendUserMessage = [];
    mockCalls.appendAssistantMessage = [];

    const config2: RunnerConfig = {
      prompt: "What was the exact code I gave you in my previous message? Reply with ONLY the code, nothing else.",
      mortDir: testDir,
      agent: "simple",
      threadId: "test-thread-1",
      historyFile: stateJsonPath,
    };

    const context2: OrchestrationContext = {
      workingDir: testDir,
      threadPath,
      threadId: "test-thread-1",
    };

    console.log("[TEST] Running Turn 2 (ask about UUID)...");
    // Turn 2: pass prior state with messages and sessionId from turn 1
    const priorSessionId = turn1State.sessionId;
    await runAgentLoop(config2, context2, agentConfig, { messages: priorMessages, sessionId: priorSessionId });

    // Verify turn 2 completed
    expect(mockCalls.appendAssistantMessage.length).toBeGreaterThan(0);

    // Get the assistant's response from turn 2
    const turn2Response = mockCalls.appendAssistantMessage[0];
    let responseText = "";

    if (typeof turn2Response.content === "string") {
      responseText = turn2Response.content;
    } else if (Array.isArray(turn2Response.content)) {
      // Extract text from content blocks
      for (const block of turn2Response.content) {
        if (typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
          responseText += (block as { type: "text"; text: string }).text;
        }
      }
    }

    console.log(`[TEST] Turn 2 response: "${responseText}"`);

    // === CRITICAL ASSERTION ===
    // The agent should have remembered the UUID from turn 1
    expect(responseText.toLowerCase()).toContain(testUuid.toLowerCase());
  }, 120000); // 2 minute timeout for live LLM calls

  /**
   * Sanity check: Verify that when NO prior messages are provided,
   * the agent cannot know the UUID (control test).
   */
  it("agent should NOT know UUID without prior messages (control test)", async () => {
    // Skip if no API key
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log("Skipping control test: ANTHROPIC_API_KEY not set");
      return;
    }
    process.env.ANTHROPIC_API_KEY = apiKey;

    const testUuid = randomUUID();
    console.log(`[CONTROL TEST] Using test UUID: ${testUuid}`);

    // Ask about a UUID without ever sending it
    const config: RunnerConfig = {
      prompt: `What was the exact code I gave you in my previous message? If you don't know, reply "I don't have any previous context."`,
      mortDir: testDir,
      agent: "simple",
      threadId: "test-thread-control",
    };

    const context: OrchestrationContext = {
      workingDir: testDir,
      threadPath,
      threadId: "test-thread-control",
    };

    const agentConfig: AgentConfig = {
      agentType: "simple",
      model: "claude-opus-4-5-20251101",
      appendedPrompt: "You are a helpful assistant.",
      tools: { type: "preset", preset: "claude_code" },
    };

    console.log("[CONTROL TEST] Running single turn (no prior context)...");
    await runAgentLoop(config, context, agentConfig, { messages: [] }); // Empty prior state

    // Get the response
    const response = mockCalls.appendAssistantMessage[0];
    let responseText = "";

    if (typeof response.content === "string") {
      responseText = response.content;
    } else if (Array.isArray(response.content)) {
      for (const block of response.content) {
        if (typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
          responseText += (block as { type: "text"; text: string }).text;
        }
      }
    }

    console.log(`[CONTROL TEST] Response: "${responseText}"`);

    // Agent should NOT contain the UUID (it was never given one)
    expect(responseText.toLowerCase()).not.toContain(testUuid.toLowerCase());
  }, 60000);
});
