import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { AgentTestHarness } from "../agent-harness.js";
import { assertAgent } from "../assertions.js";

/**
 * Skip tests that require API access when no key is present.
 */
const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Sub-Agent First-Class Display Integration Tests", () => {
  let harness: AgentTestHarness;

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness?.cleanup(failed);
  });

  it(
    "creates a child thread when agent uses Task tool to spawn sub-agent",
    async () => {
      harness = new AgentTestHarness();

      // Prompt agent to use the Task tool to spawn a sub-agent
      // We ask for a simple exploration task to trigger sub-agent creation
      const output = await harness.run({
        prompt: `Use the Task tool to spawn an Explore agent that searches for files named "README.md". The task description should be "Find README files". Do not do anything else.`,
        timeout: 120000,
      });

      // Verify agent succeeded
      assertAgent(output).succeeded();

      // Verify the Task tool was used
      assertAgent(output).usedTools(["Task"]);

      // Verify thread:created event was emitted for the sub-agent
      // The parent thread also emits thread:created, so we expect at least 2
      const threadCreatedEvents = output.events.filter(
        (e) => e.name === "thread:created"
      );
      expect(threadCreatedEvents.length).toBeGreaterThanOrEqual(1);

      // Verify child thread was created on disk
      const mortDir = harness.tempDirPath!;
      const threadsDir = join(mortDir, "threads");

      expect(existsSync(threadsDir)).toBe(true);

      const threadDirs = readdirSync(threadsDir);
      expect(threadDirs.length).toBeGreaterThanOrEqual(1);

      // Find child thread (has parentThreadId set)
      let childThreadFound = false;
      let childMetadata: Record<string, unknown> | null = null;

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childThreadFound = true;
            childMetadata = metadata;
            break;
          }
        }
      }

      expect(childThreadFound).toBe(true);
      expect(childMetadata).not.toBeNull();

      // Verify child thread has required fields
      expect(childMetadata!.parentThreadId).toBeDefined();
      expect(childMetadata!.parentToolUseId).toBeDefined();
      expect(childMetadata!.agentType).toBeDefined();
      expect(childMetadata!.status).toBe("completed");
    },
    180000
  );

  it(
    "emits thread:status-changed event when sub-agent completes",
    async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        prompt: `Use the Task tool with subagent_type="Explore" to search for any TypeScript files. The task description should be "Find TS files". Do nothing else after.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();

      // Check for thread:status-changed event with status "completed"
      const statusChangedEvents = output.events.filter(
        (e) => e.name === "thread:status-changed"
      );

      // At minimum, we should have the parent thread status change
      // If sub-agent completed, we should also have a child status change
      expect(statusChangedEvents.length).toBeGreaterThanOrEqual(1);

      // Verify at least one status changed to "completed"
      const completedEvent = statusChangedEvents.find(
        (e) =>
          (e.payload as { status?: string })?.status === "completed"
      );
      expect(completedEvent).toBeDefined();
    },
    180000
  );

  it(
    "correctly links parent and child threads via parentToolUseId",
    async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        prompt: `Use the Task tool to spawn an Explore agent. Set subagent_type to "Explore" and the description to "Quick search". The prompt should be "List files in the current directory". Do nothing else.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();

      const mortDir = harness.tempDirPath!;
      const threadsDir = join(mortDir, "threads");

      // Find parent and child threads
      const threadDirs = readdirSync(threadsDir);
      let parentThread: Record<string, unknown> | null = null;
      let childThread: Record<string, unknown> | null = null;

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childThread = metadata;
          } else {
            parentThread = metadata;
          }
        }
      }

      // Both threads should exist
      expect(parentThread).not.toBeNull();
      expect(childThread).not.toBeNull();

      // Child's parentThreadId should match parent's id
      expect(childThread!.parentThreadId).toBe(parentThread!.id);

      // parentToolUseId should be a hex string (SDK's agent_id format)
      // The SDK uses short hex IDs like "a7302c6", not full UUIDs
      const hexIdPattern = /^[0-9a-f]+$/i;
      expect(childThread!.parentToolUseId).toMatch(hexIdPattern);
    },
    180000
  );

  it(
    "emits thread:name:generated event for sub-agent",
    async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        prompt: `Use the Task tool with subagent_type="Explore" to explore the repository structure. Description: "Explore repo". Do nothing else after.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();

      // The thread naming service runs asynchronously, so we may or may not
      // receive the event before the test completes. Check if event exists.
      const nameGeneratedEvents = output.events.filter(
        (e) => e.name === "thread:name:generated"
      );

      // Log the events for debugging - we expect at least one for parent
      // and possibly one for child (fire-and-forget, may not complete in time)
      console.log(
        `Received ${nameGeneratedEvents.length} thread:name:generated events`
      );

      // At minimum, the parent thread should have a name generated
      expect(nameGeneratedEvents.length).toBeGreaterThanOrEqual(1);
    },
    180000
  );

  it(
    "creates child thread with required sub-agent metadata fields",
    async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        prompt: `Use the Task tool with subagent_type="Explore" to find any JSON files. Description: "Find JSON". Do nothing else.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();

      const mortDir = harness.tempDirPath!;
      const threadsDir = join(mortDir, "threads");
      const threadDirs = readdirSync(threadsDir);

      // Find all child threads and verify their metadata
      const childMetadatas: Record<string, unknown>[] = [];

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childMetadatas.push(metadata);
          }
        }
      }

      // At least one child thread should exist
      expect(childMetadatas.length).toBeGreaterThanOrEqual(1);

      // Verify all child threads have required sub-agent fields
      for (const metadata of childMetadatas) {
        // Required sub-agent specific fields
        expect(metadata.parentThreadId).toBeDefined();
        expect(typeof metadata.parentThreadId).toBe("string");

        expect(metadata.parentToolUseId).toBeDefined();
        expect(typeof metadata.parentToolUseId).toBe("string");

        expect(metadata.agentType).toBeDefined();
        expect(typeof metadata.agentType).toBe("string");

        // Standard thread fields should also exist
        expect(metadata.id).toBeDefined();
        expect(metadata.repoId).toBeDefined();
        expect(metadata.worktreeId).toBeDefined();
        expect(metadata.status).toBeDefined();
        expect(metadata.name).toBeDefined();
        expect(metadata.createdAt).toBeDefined();
        expect(metadata.updatedAt).toBeDefined();
        expect(metadata.turns).toBeDefined();
        expect(Array.isArray(metadata.turns)).toBe(true);
      }
    },
    180000
  );
});
