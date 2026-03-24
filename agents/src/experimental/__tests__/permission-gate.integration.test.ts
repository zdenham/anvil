/**
 * Phase 1 spike: Validate the permission gate flow end-to-end.
 *
 * Uses AgentTestHarness with --permission-mode approve to test:
 *   Q1: Does permission:request get emitted when agent uses Write/Edit?
 *   Q2: Does the agent stay connected while waiting for a response?
 *   Q3: Does sendPermissionResponse unblock the agent?
 *   Q4: Does the tool actually execute after approval?
 *   Q5: Does denial work?
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { AgentTestHarness } from "../../testing/agent-harness.js";
import { createRunnerConfig } from "../../testing/runner-config.js";
import type { SocketMessage } from "../../lib/hub/types.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

/** Runner config that passes --permission-mode approve */
const approveRunnerConfig = createRunnerConfig({
  buildArgs: (opts, anvilDirPath, repoCwd) => {
    const threadId = opts.threadId ?? randomUUID();
    const repoId = opts.repoId ?? randomUUID();
    const worktreeId = opts.worktreeId ?? randomUUID();
    return [
      "--prompt", opts.prompt,
      "--thread-id", threadId,
      "--repo-id", repoId,
      "--worktree-id", worktreeId,
      "--anvil-dir", anvilDirPath,
      "--cwd", opts.cwd ?? repoCwd,
      "--permission-mode", "approve",
      "--skip-naming",
    ];
  },
});

describeWithApi("Permission gate spike", () => {
  let harness: AgentTestHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("Q1-Q4: approve mode — Write emits permission:request, approval unblocks execution", async () => {
    const threadId = randomUUID();

    harness = new AgentTestHarness({
      runnerConfig: approveRunnerConfig,
      timeout: 120_000,
    });

    // Start the agent run in the background — we need to interact with it mid-flight
    const runPromise = harness.run({
      prompt: "Create a file called test-output.txt with the content 'hello world'. Do not use Bash, use the Write tool directly.",
      threadId,
      timeout: 120_000,
    });

    // Wait a moment for the harness to set up, then get the mock hub
    // We need to poll briefly since run() creates the hub asynchronously
    let mockHub = harness.getMockHub();
    const hubWaitStart = Date.now();
    while (!mockHub && Date.now() - hubWaitStart < 10_000) {
      await new Promise((r) => setTimeout(r, 100));
      mockHub = harness.getMockHub();
    }

    if (!mockHub) {
      throw new Error("MockHubServer not available after 10s");
    }

    console.log("[spike] MockHub available, waiting for permission:request event...");

    // Wait for the permission:request event
    let permissionEvent: SocketMessage | null = null;
    try {
      permissionEvent = await mockHub.waitForMessage(
        (msg) => msg.type === "event" && (msg as { name?: string }).name === "permission:request",
        90_000,
      );
      console.log(`[spike] Got permission:request event: ${JSON.stringify(permissionEvent)}`);
    } catch (err) {
      console.log(`[spike] Timeout waiting for permission:request: ${err}`);
    }

    // Q1: Did we get the event?
    expect(permissionEvent).toBeDefined();
    const payload = (permissionEvent as { payload?: Record<string, unknown> })?.payload;
    console.log(`[spike] Event payload: ${JSON.stringify(payload)}`);

    // Validate event shape
    expect(payload).toBeDefined();
    expect(payload?.requestId).toBeDefined();
    expect(payload?.threadId).toBe(threadId);
    expect(payload?.toolName).toBeDefined();
    console.log(`[spike] toolName: ${payload?.toolName}`);

    // Q2: Is the agent still connected?
    const stillConnected = mockHub.isConnected(threadId);
    console.log(`[spike] Agent still connected: ${stillConnected}`);
    expect(stillConnected).toBe(true);

    // Q3: Send approval
    const requestId = payload?.requestId as string;
    console.log(`[spike] Sending approval for requestId: ${requestId}`);
    mockHub.sendPermissionResponse(threadId, true, requestId);

    // Wait for agent to complete
    const result = await runPromise;

    console.log(`[spike] Agent exited with code: ${result.exitCode}`);
    console.log(`[spike] Duration: ${result.durationMs}ms`);
    console.log(`[spike] Events: ${result.events.map((e) => e.name).join(", ")}`);

    // Q4: Did the file get created?
    const repoPath = harness.repoPath!;
    const filePath = join(repoPath, "test-output.txt");
    const fileExists = existsSync(filePath);
    console.log(`[spike] File created: ${fileExists} (path: ${filePath})`);

    // Assertions
    expect(result.exitCode).toBe(0);
    expect(fileExists).toBe(true);
  }, 150_000);

  it("Q5: approve mode — denying permission prevents tool execution", async () => {
    const threadId = randomUUID();

    harness = new AgentTestHarness({
      runnerConfig: approveRunnerConfig,
      timeout: 120_000,
    });

    const runPromise = harness.run({
      prompt: "Create a file called denied-file.txt with the content 'should not exist'. Use the Write tool. If the tool is denied, just say 'Permission denied' and stop.",
      threadId,
      timeout: 120_000,
    });

    // Wait for mock hub
    let mockHub = harness.getMockHub();
    const hubWaitStart = Date.now();
    while (!mockHub && Date.now() - hubWaitStart < 10_000) {
      await new Promise((r) => setTimeout(r, 100));
      mockHub = harness.getMockHub();
    }

    if (!mockHub) {
      throw new Error("MockHubServer not available after 10s");
    }

    console.log("[spike:deny] MockHub available, waiting for permission:request...");

    let permissionEvent: SocketMessage | null = null;
    try {
      permissionEvent = await mockHub.waitForMessage(
        (msg) => msg.type === "event" && (msg as { name?: string }).name === "permission:request",
        90_000,
      );
      console.log(`[spike:deny] Got permission:request: ${JSON.stringify(permissionEvent)}`);
    } catch (err) {
      console.log(`[spike:deny] Timeout waiting for permission:request: ${err}`);
    }

    expect(permissionEvent).toBeDefined();
    const payload = (permissionEvent as { payload?: Record<string, unknown> })?.payload;
    const requestId = payload?.requestId as string;

    // Send denial
    console.log(`[spike:deny] Sending denial for requestId: ${requestId}`);
    mockHub.sendPermissionResponse(threadId, false, requestId);

    // Wait for agent to complete
    const result = await runPromise;

    console.log(`[spike:deny] Agent exited with code: ${result.exitCode}`);
    console.log(`[spike:deny] Duration: ${result.durationMs}ms`);

    // File should NOT exist
    const repoPath = harness.repoPath!;
    const filePath = join(repoPath, "denied-file.txt");
    const fileExists = existsSync(filePath);
    console.log(`[spike:deny] File created: ${fileExists} (path: ${filePath})`);

    expect(result.exitCode).toBe(0);
    expect(fileExists).toBe(false);
  }, 150_000);

  it("agent stays connected during 5-second wait for permission response", async () => {
    const threadId = randomUUID();

    harness = new AgentTestHarness({
      runnerConfig: approveRunnerConfig,
      timeout: 120_000,
    });

    const runPromise = harness.run({
      prompt: "Create a file called delayed-test.txt with content 'delayed approval'. Use the Write tool directly.",
      threadId,
      timeout: 120_000,
    });

    // Wait for mock hub
    let mockHub = harness.getMockHub();
    const hubWaitStart = Date.now();
    while (!mockHub && Date.now() - hubWaitStart < 10_000) {
      await new Promise((r) => setTimeout(r, 100));
      mockHub = harness.getMockHub();
    }

    if (!mockHub) {
      throw new Error("MockHubServer not available after 10s");
    }

    let permissionEvent: SocketMessage | null = null;
    try {
      permissionEvent = await mockHub.waitForMessage(
        (msg) => msg.type === "event" && (msg as { name?: string }).name === "permission:request",
        90_000,
      );
    } catch (err) {
      console.log(`[spike:delay] Timeout: ${err}`);
    }

    expect(permissionEvent).toBeDefined();
    const payload = (permissionEvent as { payload?: Record<string, unknown> })?.payload;
    const requestId = payload?.requestId as string;

    // Wait 5 seconds before responding
    console.log("[spike:delay] Waiting 5 seconds before responding...");
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const connected = mockHub.isConnected(threadId);
      console.log(`[spike:delay] t+${i + 1}s — connected: ${connected}`);
      expect(connected).toBe(true);
    }

    // Send approval after delay
    mockHub.sendPermissionResponse(threadId, true, requestId);

    const result = await runPromise;
    console.log(`[spike:delay] Agent exited with code: ${result.exitCode}`);

    const repoPath = harness.repoPath!;
    const filePath = join(repoPath, "delayed-test.txt");
    expect(existsSync(filePath)).toBe(true);
    expect(result.exitCode).toBe(0);
  }, 150_000);
});
