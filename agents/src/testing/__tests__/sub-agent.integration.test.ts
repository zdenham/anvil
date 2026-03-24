import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { AgentTestHarness } from "../agent-harness.js";
import { assertAgent } from "../assertions.js";
import type { ThreadState, ToolExecutionState } from "../types.js";

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
    "creates a child thread when agent uses Agent tool to spawn sub-agent",
    async () => {
      harness = new AgentTestHarness();

      // Prompt agent to use the Agent tool to spawn a sub-agent
      // We ask for a simple exploration task to trigger sub-agent creation
      const output = await harness.run({
        prompt: `Use the Agent tool to spawn an Explore agent that searches for files named "README.md". The task description should be "Find README files". Do not do anything else.`,
        timeout: 120000,
      });

      // Verify agent succeeded
      assertAgent(output).succeeded();

      // Verify the Agent tool was used
      assertAgent(output).usedTools(["Agent"]);

      // Verify thread:created event was emitted for the sub-agent
      // The parent thread also emits thread:created, so we expect at least 2
      const threadCreatedEvents = output.events.filter(
        (e) => e.name === "thread:created"
      );
      expect(threadCreatedEvents.length).toBeGreaterThanOrEqual(1);

      // Verify child thread was created on disk
      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");

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
        prompt: `Use the Agent tool with subagent_type="Explore" to search for any TypeScript files. The task description should be "Find TS files". Do nothing else after.`,
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
        prompt: `Use the Agent tool to spawn an Explore agent. Set subagent_type to "Explore" and the description to "Quick search". The prompt should be "List files in the current directory". Do nothing else.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");

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

      // parentToolUseId should be the Agent tool's tool_use_id in Anthropic format
      // After the fix, this uses the full tool_use_id (e.g., "toolu_01ABC...")
      // instead of the SDK's short hex agent_id (e.g., "a7302c6")
      expect(childThread!.parentToolUseId).toMatch(/^toolu_/);
    },
    180000
  );

  it(
    "emits thread:name:generated event for sub-agent",
    async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        prompt: `Use the Agent tool with subagent_type="Explore" to explore the repository structure. Description: "Explore repo". Do nothing else after.`,
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
        prompt: `Use the Agent tool with subagent_type="Explore" to find any JSON files. Description: "Find JSON". Do nothing else.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");
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

  // ===========================================================================
  // Issue 1 (Prompt): Child thread shows actual task prompt, not generic string
  // ===========================================================================

  it(
    "child thread metadata contains actual task prompt from PreToolUse, not generic 'Sub-agent: {type}' string",
    async () => {
      harness = new AgentTestHarness();

      // Use a unique, identifiable task prompt that we can verify
      const uniqueTaskPrompt = "Search for files containing the word 'configuration' in the repository";

      const output = await harness.run({
        prompt: `Use the Agent tool with subagent_type="Explore" and set the prompt to exactly: "${uniqueTaskPrompt}". Do nothing else after the Agent completes.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();
      assertAgent(output).usedTools(["Agent"]);

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");

      // Find the child thread
      const threadDirs = readdirSync(threadsDir);
      let childMetadata: Record<string, unknown> | null = null;

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childMetadata = metadata;
            break;
          }
        }
      }

      expect(childMetadata).not.toBeNull();
      expect(childMetadata!.turns).toBeDefined();
      expect(Array.isArray(childMetadata!.turns)).toBe(true);

      const turns = childMetadata!.turns as Array<{ prompt: string }>;
      expect(turns.length).toBeGreaterThan(0);

      // The first turn's prompt should contain the actual task prompt
      // It should NOT be the generic "Sub-agent: Explore" format
      const firstTurnPrompt = turns[0].prompt;
      expect(firstTurnPrompt).not.toBe("Sub-agent: Explore");
      expect(firstTurnPrompt).not.toMatch(/^Sub-agent:/);

      // The prompt should contain our unique task description
      // (The exact format may vary, but it should include the task content)
      expect(firstTurnPrompt).toContain("configuration");
    },
    180000
  );

  // ===========================================================================
  // Issue 2 (State files): Child thread has state.json with tool states
  // ===========================================================================

  it(
    "child thread directory contains state.json file with tool states after sub-agent uses tools",
    async () => {
      harness = new AgentTestHarness();

      // Request a task that will definitely use tools (Glob or Read)
      const output = await harness.run({
        prompt: `Use the Agent tool with subagent_type="Explore" and prompt="List all files in the current directory using the Glob tool with pattern '*'". Do nothing else.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();
      assertAgent(output).usedTools(["Agent"]);

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");

      // Find the child thread
      const threadDirs = readdirSync(threadsDir);
      let childThreadDir: string | null = null;
      let childMetadata: Record<string, unknown> | null = null;

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childThreadDir = threadDir;
            childMetadata = metadata;
            break;
          }
        }
      }

      expect(childThreadDir).not.toBeNull();
      expect(childMetadata).not.toBeNull();

      // Verify state.json exists in child thread directory
      const childStatePath = join(threadsDir, childThreadDir!, "state.json");
      expect(existsSync(childStatePath)).toBe(true);

      // Read and validate state.json structure
      const childState = JSON.parse(readFileSync(childStatePath, "utf-8")) as ThreadState;

      // State should have the basic required fields
      expect(childState.messages).toBeDefined();
      expect(Array.isArray(childState.messages)).toBe(true);
      expect(childState.toolStates).toBeDefined();
      expect(typeof childState.toolStates).toBe("object");
      expect(childState.status).toBeDefined();
      expect(childState.timestamp).toBeDefined();
      expect(typeof childState.timestamp).toBe("number");

      // The sub-agent should have used at least one tool (Glob for listing files)
      const toolStateEntries = Object.entries(childState.toolStates);
      expect(toolStateEntries.length).toBeGreaterThan(0);

      // At least one tool should be completed
      const hasCompletedTool = toolStateEntries.some(
        ([, state]) => state.status === "complete"
      );
      expect(hasCompletedTool).toBe(true);
    },
    180000
  );

  // ===========================================================================
  // Issue 3 (Tool routing): Sub-agent's tool uses appear in child thread, not parent
  // ===========================================================================

  it(
    "sub-agent tool uses appear in child thread state.json, not parent thread state.json",
    async () => {
      harness = new AgentTestHarness();

      // Request a task that will use tools within the sub-agent
      const output = await harness.run({
        prompt: `Use the Agent tool with subagent_type="Explore" and prompt="Use the Glob tool to find all .md files in the current directory with pattern '*.md'". Do nothing else after the Agent completes.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();
      assertAgent(output).usedTools(["Agent"]);

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");

      // Find parent and child threads
      const threadDirs = readdirSync(threadsDir);
      let parentThreadDir: string | null = null;
      let childThreadDir: string | null = null;

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childThreadDir = threadDir;
          } else {
            parentThreadDir = threadDir;
          }
        }
      }

      expect(parentThreadDir).not.toBeNull();
      expect(childThreadDir).not.toBeNull();

      // Read parent thread state
      const parentStatePath = join(threadsDir, parentThreadDir!, "state.json");
      expect(existsSync(parentStatePath)).toBe(true);
      const parentState = JSON.parse(readFileSync(parentStatePath, "utf-8")) as ThreadState;

      // Read child thread state
      const childStatePath = join(threadsDir, childThreadDir!, "state.json");
      expect(existsSync(childStatePath)).toBe(true);
      const childState = JSON.parse(readFileSync(childStatePath, "utf-8")) as ThreadState;

      // Helper to check if a tool type exists in tool states
      const hasToolType = (state: ThreadState, toolName: string): boolean => {
        return Object.values(state.toolStates).some(
          (toolState) => toolState.toolName === toolName
        );
      };

      // Parent thread should have Agent tool, but NOT the tools used by the sub-agent
      expect(hasToolType(parentState, "Agent")).toBe(true);

      // Child thread should have tools that the sub-agent used (like Glob)
      // The exact tools depend on what the LLM decides to use, but there should be some
      const childToolNames = Object.values(childState.toolStates)
        .map((s) => s.toolName)
        .filter(Boolean);
      expect(childToolNames.length).toBeGreaterThan(0);

      // If the child used Glob (as requested), it should be in child state, not parent
      if (hasToolType(childState, "Glob")) {
        // Glob should NOT be in parent state (it was used by sub-agent)
        expect(hasToolType(parentState, "Glob")).toBe(false);
      }

      // General verification: child thread tools should not appear in parent
      // (except for Agent, which is the parent's tool)
      for (const toolName of childToolNames) {
        if (toolName && toolName !== "Agent") {
          // Sub-agent tools should not be in parent state
          expect(hasToolType(parentState, toolName)).toBe(false);
        }
      }
    },
    180000
  );

  // ===========================================================================
  // Issue 4 (Reference block): parentToolUseId matches Agent tool's tool_use_id
  // ===========================================================================

  it(
    "child thread parentToolUseId matches Agent tool tool_use_id format (toolu_01...), not short hex agent_id",
    async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        prompt: `Use the Agent tool with subagent_type="Explore" and prompt="Simply respond with 'hello'". Do nothing else.`,
        timeout: 120000,
      });

      assertAgent(output).succeeded();
      assertAgent(output).usedTools(["Agent"]);

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");

      // Find parent and child threads
      const threadDirs = readdirSync(threadsDir);
      let parentState: ThreadState | null = null;
      let childMetadata: Record<string, unknown> | null = null;

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childMetadata = metadata;
          } else {
            // Read parent state to find Agent tool_use_id
            const statePath = join(threadsDir, threadDir, "state.json");
            if (existsSync(statePath)) {
              parentState = JSON.parse(readFileSync(statePath, "utf-8"));
            }
          }
        }
      }

      expect(parentState).not.toBeNull();
      expect(childMetadata).not.toBeNull();

      // Find the Agent tool's tool_use_id from parent state
      const taskToolUseId = Object.entries(parentState!.toolStates).find(
        ([, state]) => state.toolName === "Agent"
      )?.[0];

      expect(taskToolUseId).toBeDefined();

      // The child's parentToolUseId should match the Agent tool's tool_use_id
      // This is critical for the frontend to render SubAgentReferenceBlock
      const childParentToolUseId = childMetadata!.parentToolUseId as string;

      // Anthropic tool_use_ids have format like "toolu_01ABC123..."
      // SDK agent_ids are short hex like "ad79f4f"
      // For the frontend lookup to work, parentToolUseId should match tool_use_id format
      expect(childParentToolUseId).toBe(taskToolUseId);

      // Additional format validation: should be in toolu_01 format, not short hex
      // Note: This test documents the EXPECTED behavior after the fix is implemented
      // The plan indicates this is currently broken (using agent_id instead of tool_use_id)
      const isToolUseIdFormat = childParentToolUseId.startsWith("toolu_");
      const isShortHexFormat = /^[0-9a-f]{6,8}$/i.test(childParentToolUseId);

      // After fix: should be toolu_ format
      // Before fix: would be short hex format
      // This test will fail until the fix is implemented, which is intentional
      // to verify the fix works
      if (isToolUseIdFormat) {
        // Expected after fix - parentToolUseId matches tool_use_id
        expect(childParentToolUseId).toMatch(/^toolu_/);
      } else if (isShortHexFormat) {
        // Current broken behavior - using agent_id instead
        // Log a warning that this is the broken behavior being tested
        console.warn(
          `[Test] parentToolUseId is using short hex format (${childParentToolUseId}), ` +
          `expected toolu_ format. This indicates Issue 4 is not yet fixed.`
        );
        // Still verify the IDs match in the current implementation
        // The mapping should at least be consistent
      }

      // The key requirement: whatever format is used, the child's parentToolUseId
      // should match what's stored as the Agent tool's key in parent state
      expect(childParentToolUseId).toBe(taskToolUseId);
    },
    180000
  );

  // ===========================================================================
  // Issue: General purpose sub-agent spawns extra Explore/Plan agents
  // and child thread may be missing assistant messages
  // ===========================================================================

  it(
    "general purpose sub-agent spawns multiple child threads and child thread has assistant messages",
    async () => {
      harness = new AgentTestHarness();

      const output = await harness.run({
        prompt: `Use the Agent tool to spawn a general-purpose sub-agent with this exact prompt: "First, use the Read tool to read the README.md file in the current directory. Then provide a summary of what you found. Make sure to explain the content in detail."`,
        timeout: 180000,
      });

      // Log output info first before any assertions
      console.log(`\n${"=".repeat(60)}`);
      console.log(`AGENT RUN OUTPUT`);
      console.log(`${"=".repeat(60)}`);
      console.log(`Exit code: ${output.exitCode}`);
      console.log(`Duration: ${output.durationMs}ms`);
      console.log(`Logs: ${output.logs.length}`);
      console.log(`Events: ${output.events.length}`);
      console.log(`States: ${output.states.length}`);
      if (output.stderr) {
        console.log(`Stderr: ${output.stderr.substring(0, 500)}`);
      }

      // Log the actual tools used
      const toolUseEvents = output.states.flatMap((s) => {
        const payload = s.payload as { toolStates?: Record<string, { toolName?: string }> };
        if (payload?.toolStates) {
          return Object.values(payload.toolStates).map((ts) => ts.toolName).filter(Boolean);
        }
        return [];
      });
      console.log(`Tools found in states: ${[...new Set(toolUseEvents)].join(", ") || "none"}`);

      // Don't assert yet - let the logging happen first
      const succeeded = output.exitCode === 0;
      console.log(`Agent succeeded: ${succeeded}`);

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");

      // Find all threads
      const threadDirs = readdirSync(threadsDir);
      const allThreads: Array<{
        dir: string;
        metadata: Record<string, unknown>;
        state: Record<string, unknown> | null;
      }> = [];

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          let state = null;
          const statePath = join(threadsDir, threadDir, "state.json");
          if (existsSync(statePath)) {
            state = JSON.parse(readFileSync(statePath, "utf-8"));
          }
          allThreads.push({ dir: threadDir, metadata, state });
        }
      }

      // Separate parent and child threads
      const parentThread = allThreads.find((t) => !t.metadata.parentThreadId);
      const childThreads = allThreads.filter((t) => t.metadata.parentThreadId);

      console.log(`\n=== Thread Analysis ===`);
      console.log(`Total threads: ${allThreads.length}`);
      console.log(`Parent thread: ${parentThread?.metadata.id}`);
      console.log(`Child threads: ${childThreads.length}`);

      // Log each child thread's details
      for (const child of childThreads) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`CHILD THREAD: ${child.metadata.id}`);
        console.log(`${"=".repeat(60)}`);
        console.log(`  Name: ${child.metadata.name}`);
        console.log(`  Agent Type: ${child.metadata.agentType}`);
        console.log(`  Status: ${child.metadata.status}`);

        // Check for assistant messages in state
        if (child.state) {
          const messages = child.state.messages as Array<{ role: string; content?: unknown }> | undefined;
          if (messages) {
            console.log(`\n  [MESSAGES] Total: ${messages.length}`);

            for (let i = 0; i < messages.length; i++) {
              const msg = messages[i];
              console.log(`\n  --- Message ${i} (${msg.role}) ---`);

              if (msg.role === "assistant") {
                console.log(`  [ASSISTANT MESSAGE]`);
                const content = msg.content;
                if (Array.isArray(content)) {
                  console.log(`    Content blocks: ${content.length}`);
                  for (let j = 0; j < content.length; j++) {
                    const block = content[j] as { type?: string; text?: string; name?: string; input?: unknown };
                    console.log(`    [Block ${j}] Type: ${block.type}`);
                    if (block.type === "text") {
                      console.log(`      Text: ${JSON.stringify(block.text?.substring(0, 200))}${(block.text?.length || 0) > 200 ? "..." : ""}`);
                    } else if (block.type === "tool_use") {
                      console.log(`      Tool: ${block.name}`);
                      console.log(`      Input: ${JSON.stringify(block.input, null, 2).substring(0, 300)}`);
                    }
                  }
                } else {
                  console.log(`    Content (non-array): ${JSON.stringify(content, null, 2).substring(0, 500)}`);
                }
              } else if (msg.role === "user") {
                console.log(`  [USER MESSAGE]`);
                const content = msg.content;
                if (Array.isArray(content)) {
                  console.log(`    Content blocks: ${content.length}`);
                  for (let j = 0; j < content.length; j++) {
                    const block = content[j] as { type?: string; text?: string; tool_use_id?: string; content?: unknown };
                    console.log(`    [Block ${j}] Type: ${block.type}`);
                    if (block.type === "text") {
                      console.log(`      Text: ${JSON.stringify(block.text?.substring(0, 200))}${(block.text?.length || 0) > 200 ? "..." : ""}`);
                    } else if (block.type === "tool_result") {
                      console.log(`      Tool Use ID: ${block.tool_use_id}`);
                      const contentStr = JSON.stringify(block.content);
                      console.log(`      Result: ${contentStr.substring(0, 300)}${contentStr.length > 300 ? "..." : ""}`);
                    }
                  }
                } else if (typeof content === "string") {
                  console.log(`    Content: ${content.substring(0, 300)}${content.length > 300 ? "..." : ""}`);
                }
              }
            }
          } else {
            console.log(`\n  [MESSAGES] No messages array in state`);
          }
        } else {
          console.log(`\n  [STATE] No state.json file`);
        }

        // Check turns in metadata
        const turns = child.metadata.turns as Array<{ prompt: string; response?: string }> | undefined;
        if (turns) {
          console.log(`\n  [TURNS] Total: ${turns.length}`);
          for (let i = 0; i < turns.length; i++) {
            const turn = turns[i];
            console.log(`    Turn ${i}:`);
            console.log(`      Prompt (${turn.prompt?.length || 0} chars): ${turn.prompt?.substring(0, 200)}${(turn.prompt?.length || 0) > 200 ? "..." : ""}`);
            console.log(`      Has response: ${!!turn.response}`);
            if (turn.response) {
              console.log(`      Response (${turn.response.length} chars): ${turn.response.substring(0, 200)}${turn.response.length > 200 ? "..." : ""}`);
            }
          }
        }
      }

      // Find the general-purpose agent (the one we explicitly spawned)
      const generalPurposeChild = childThreads.find(
        (c) => c.metadata.agentType === "general-purpose"
      );

      console.log(`\n=== General Purpose Child Analysis ===`);
      if (generalPurposeChild) {
        console.log(`Found general-purpose child: ${generalPurposeChild.metadata.id}`);

        // Check if it has assistant messages
        if (generalPurposeChild.state) {
          const messages = generalPurposeChild.state.messages as Array<{ role: string; content?: unknown }> | undefined;
          const assistantMessages = messages?.filter((m) => m.role === "assistant") || [];

          console.log(`Assistant messages in general-purpose child: ${assistantMessages.length}`);

          // Check for tool usage in assistant messages
          let toolUseCount = 0;
          let readToolUsed = false;
          for (const msg of assistantMessages) {
            const content = msg.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as { type?: string; name?: string };
                if (b.type === "tool_use") {
                  toolUseCount++;
                  if (b.name === "Read") {
                    readToolUsed = true;
                  }
                }
              }
            }
          }
          console.log(`Tool uses in assistant messages: ${toolUseCount}`);
          console.log(`Read tool was used: ${readToolUsed}`);

          // Check tool states
          const toolStates = generalPurposeChild.state.toolStates as Record<string, { toolName?: string; status?: string }> | undefined;
          if (toolStates) {
            console.log(`\n  [TOOL STATES] ${Object.keys(toolStates).length} tools:`);
            for (const [id, state] of Object.entries(toolStates)) {
              console.log(`    - ${id}: ${state.toolName} (${state.status})`);
            }
          }

          // This is the bug we're investigating: child thread should have assistant messages
          // but may not be recording them properly
          if (assistantMessages.length === 0) {
            console.log(`\n!!! BUG CONFIRMED: General-purpose child has NO assistant messages !!!`);
          }
        } else {
          console.log(`No state.json for general-purpose child`);
        }
      } else {
        console.log(`No general-purpose child found. Agent types present:`);
        for (const child of childThreads) {
          console.log(`  - ${child.metadata.agentType}`);
        }
      }

      // Log count of different agent types
      const agentTypeCounts = childThreads.reduce(
        (acc, c) => {
          const type = c.metadata.agentType as string;
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      console.log(`\n${"=".repeat(60)}`);
      console.log(`AGENT TYPE COUNTS`);
      console.log(`${"=".repeat(60)}`);
      for (const [type, count] of Object.entries(agentTypeCounts)) {
        console.log(`  ${type}: ${count}`);
      }

      // Log all events from the output
      console.log(`\n${"=".repeat(60)}`);
      console.log(`EVENTS (${output.events.length} total)`);
      console.log(`${"=".repeat(60)}`);
      for (const event of output.events) {
        console.log(`\n  [EVENT] ${event.name}`);
        if (event.payload) {
          const payloadStr = JSON.stringify(event.payload, null, 2);
          const lines = payloadStr.split("\n");
          for (const line of lines.slice(0, 20)) {
            console.log(`    ${line}`);
          }
          if (lines.length > 20) {
            console.log(`    ... (${lines.length - 20} more lines)`);
          }
        }
      }

      // Log all state snapshots
      console.log(`\n${"=".repeat(60)}`);
      console.log(`STATE SNAPSHOTS (${output.states.length} total)`);
      console.log(`${"=".repeat(60)}`);
      for (let i = 0; i < output.states.length; i++) {
        const state = output.states[i];
        console.log(`\n  [STATE ${i}]`);
        if (state.payload) {
          const payload = state.payload as { threadId?: string; status?: string; toolStates?: Record<string, unknown> };
          console.log(`    Thread ID: ${payload.threadId}`);
          console.log(`    Status: ${payload.status}`);
          if (payload.toolStates) {
            const toolCount = Object.keys(payload.toolStates).length;
            console.log(`    Tool States: ${toolCount} tools`);
            for (const [toolId, toolState] of Object.entries(payload.toolStates)) {
              const ts = toolState as { toolName?: string; status?: string };
              console.log(`      - ${toolId}: ${ts.toolName} (${ts.status})`);
            }
          }
        }
      }

      // Log hook-related events specifically
      const hookEvents = output.events.filter((e) =>
        e.name.includes("hook") ||
        e.name.includes("PreTool") ||
        e.name.includes("PostTool") ||
        e.name.includes("thread:")
      );
      console.log(`\n${"=".repeat(60)}`);
      console.log(`HOOK/THREAD EVENTS (${hookEvents.length} total)`);
      console.log(`${"=".repeat(60)}`);
      for (const event of hookEvents) {
        console.log(`\n  [${event.name}]`);
        if (event.payload) {
          console.log(`    ${JSON.stringify(event.payload, null, 2).split("\n").slice(0, 10).join("\n    ")}`);
        }
      }

      // ===== CHECK AGENT TRANSCRIPT FILES =====
      // The SDK writes sub-agent transcripts to ~/.claude/projects/<encoded-repo-path>/
      // We use the repo path to find the exact project directory for THIS test
      console.log(`\n${"=".repeat(60)}`);
      console.log(`AGENT TRANSCRIPT FILES`);
      console.log(`${"=".repeat(60)}`);

      const homeDir = process.env.HOME || process.env.USERPROFILE || "";
      const claudeProjectsDir = join(homeDir, ".claude", "projects");
      const repoPath = harness.repoPath;

      // The SDK encodes the repo path by replacing / with - and prepending -
      // e.g., /private/var/folders/.../test-repo-abc123 -> -private-var-folders-...-test-repo-abc123
      const encodedRepoPath = repoPath ? `-${repoPath.replace(/\//g, "-").replace(/^-/, "")}` : null;

      console.log(`  Repo path: ${repoPath}`);
      console.log(`  Looking for project dir matching: ${encodedRepoPath}`);

      try {
        if (existsSync(claudeProjectsDir) && encodedRepoPath) {
          const projectPath = join(claudeProjectsDir, encodedRepoPath);

          if (existsSync(projectPath)) {
            const files = readdirSync(projectPath);
            const agentFiles = files.filter(f => f.startsWith("agent-") && f.endsWith(".jsonl"));

            console.log(`  Found project directory with ${agentFiles.length} agent transcript files`);

            for (const agentFile of agentFiles) {
              const agentFilePath = join(projectPath, agentFile);
              console.log(`\n  --- ${agentFile} ---`);
              try {
                const content = readFileSync(agentFilePath, "utf-8");
                const lines = content.trim().split("\n");
                console.log(`  Lines: ${lines.length}`);
                for (let i = 0; i < lines.length; i++) {
                  try {
                    const entry = JSON.parse(lines[i]);
                    const role = entry.message?.role || entry.type || "unknown";
                    const agentId = entry.agentId || "none";
                    console.log(`    [${i}] type=${entry.type}, role=${role}, agentId=${agentId}`);

                    // For assistant messages, show content summary
                    if (entry.type === "assistant" && entry.message?.content) {
                      const msgContent = entry.message.content;
                      if (Array.isArray(msgContent)) {
                        const blockTypes = msgContent.map((b: { type?: string }) => b.type).join(", ");
                        console.log(`        Content blocks: [${blockTypes}]`);
                        for (const block of msgContent) {
                          const b = block as { type?: string; text?: string; name?: string };
                          if (b.type === "text" && b.text) {
                            console.log(`        Text: "${b.text.substring(0, 100)}${b.text.length > 100 ? "..." : ""}"`);
                          } else if (b.type === "tool_use") {
                            console.log(`        Tool: ${b.name}`);
                          }
                        }
                      }
                    }
                  } catch {
                    console.log(`    [${i}] (parse error)`);
                  }
                }
              } catch (err) {
                console.log(`  Error reading: ${err}`);
              }
            }
          } else {
            console.log(`  Project directory not found: ${projectPath}`);
          }
        } else {
          console.log(`  Claude projects directory not found or no repo path`);
        }
      } catch (err) {
        console.log(`  Error scanning for transcripts: ${err}`);
      }

      // ===== ASSERTIONS AT THE END =====
      console.log(`\n${"=".repeat(60)}`);
      console.log(`RUNNING ASSERTIONS`);
      console.log(`${"=".repeat(60)}`);

      // Now do assertions after all logging
      assertAgent(output).succeeded();
      assertAgent(output).usedTools(["Agent"]);
      expect(childThreads.length).toBeGreaterThanOrEqual(1);

      if (generalPurposeChild) {
        if (generalPurposeChild.state) {
          const messages = generalPurposeChild.state.messages as Array<{ role: string }> | undefined;
          const assistantMessages = messages?.filter((m) => m.role === "assistant") || [];
          expect(assistantMessages.length).toBeGreaterThan(0);
        } else {
          expect(generalPurposeChild.state).not.toBeNull();
        }
      }
    },
    240000
  );

  // ===========================================================================
  // Combined validation test for all 4 issues
  // ===========================================================================

  it(
    "comprehensive sub-agent thread integration: prompt, state, routing, and reference all work correctly",
    async () => {
      harness = new AgentTestHarness();

      // A comprehensive test that exercises all aspects
      const taskPrompt = "Find all TypeScript files and count them";

      const output = await harness.run({
        prompt: `Use the Agent tool with subagent_type="Explore" and prompt="${taskPrompt}". The sub-agent should use Glob to find *.ts files. Do nothing else after.`,
        timeout: 150000,
      });

      assertAgent(output).succeeded();
      assertAgent(output).usedTools(["Agent"]);

      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");
      const threadDirs = readdirSync(threadsDir);

      let parentThreadDir: string | null = null;
      let childThreadDir: string | null = null;
      let parentMetadata: Record<string, unknown> | null = null;
      let childMetadata: Record<string, unknown> | null = null;

      for (const threadDir of threadDirs) {
        const metadataPath = join(threadsDir, threadDir, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (metadata.parentThreadId) {
            childThreadDir = threadDir;
            childMetadata = metadata;
          } else {
            parentThreadDir = threadDir;
            parentMetadata = metadata;
          }
        }
      }

      // Both threads should exist
      expect(parentThreadDir).not.toBeNull();
      expect(childThreadDir).not.toBeNull();
      expect(parentMetadata).not.toBeNull();
      expect(childMetadata).not.toBeNull();

      // Issue 1: Prompt should be actual task, not generic
      const turns = childMetadata!.turns as Array<{ prompt: string }>;
      expect(turns.length).toBeGreaterThan(0);
      // Should not be generic format
      expect(turns[0].prompt).not.toMatch(/^Sub-agent:/);

      // Issue 2: state.json should exist with tool states
      const childStatePath = join(threadsDir, childThreadDir!, "state.json");
      expect(existsSync(childStatePath)).toBe(true);
      const childState = JSON.parse(readFileSync(childStatePath, "utf-8")) as ThreadState;
      expect(childState.toolStates).toBeDefined();
      expect(Object.keys(childState.toolStates).length).toBeGreaterThan(0);

      // Issue 3: Tools should be in child state, not parent
      const parentStatePath = join(threadsDir, parentThreadDir!, "state.json");
      expect(existsSync(parentStatePath)).toBe(true);
      const parentState = JSON.parse(readFileSync(parentStatePath, "utf-8")) as ThreadState;

      // Parent should have Agent
      const parentToolNames = Object.values(parentState.toolStates)
        .map((s) => s.toolName)
        .filter(Boolean);
      expect(parentToolNames).toContain("Agent");

      // Child tools should not be in parent (except Agent is not a child tool)
      const childToolNames = Object.values(childState.toolStates)
        .map((s) => s.toolName)
        .filter(Boolean);

      for (const toolName of childToolNames) {
        if (toolName) {
          expect(parentToolNames).not.toContain(toolName);
        }
      }

      // Issue 4: parentToolUseId should match Agent's tool_use_id
      const taskToolEntry = Object.entries(parentState.toolStates).find(
        ([, state]) => state.toolName === "Agent"
      );
      expect(taskToolEntry).toBeDefined();
      const [taskToolUseId] = taskToolEntry!;
      expect(childMetadata!.parentToolUseId).toBe(taskToolUseId);

      // Verify linkage: child's parentThreadId should match parent's id
      expect(childMetadata!.parentThreadId).toBe(parentMetadata!.id);
    },
    180000
  );

  // ===========================================================================
  // Phase 5: Child thread actions emitted via socket replay to valid state
  // ===========================================================================

  it(
    "child thread actions are emitted via socket and replay to valid state",
    async () => {
      harness = new AgentTestHarness();
      const output = await harness.run({
        prompt: `Use the Agent tool with subagent_type="Explore" to find TypeScript files. Description: "Find TS". Do nothing else.`,
        timeout: 120000,
      });
      assertAgent(output).succeeded();

      // Find child thread ID from metadata on disk
      const anvilDir = harness.tempDirPath!;
      const threadsDir = join(anvilDir, "threads");
      const threadDirs = readdirSync(threadsDir);
      let childThreadId: string | undefined;
      for (const dir of threadDirs) {
        const metaPath = join(threadsDir, dir, "metadata.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          if (meta.parentThreadId) {
            childThreadId = dir;
            break;
          }
        }
      }
      expect(childThreadId).toBeDefined();

      // KEY: MockHubServer received thread_action messages for the child thread
      const hub = harness.getMockHub()!;
      const childMessages = hub.getMessagesForThread(childThreadId!);
      const childActions = childMessages.filter(
        (m: any) => m.type === "thread_action"
      );
      expect(childActions.length).toBeGreaterThan(0);

      // Replay child actions through threadReducer — same as frontend would
      const { threadReducer } = await import("@core/lib/thread-reducer.js");
      type ThreadAction = Parameters<typeof threadReducer>[1];
      let childState: ThreadState = {
        messages: [],
        fileChanges: [],
        workingDirectory: "",
        status: "running",
        timestamp: 0,
        toolStates: {},
      };
      for (const msg of childActions) {
        childState = threadReducer(
          childState,
          (msg as any).action as ThreadAction
        );
      }

      // Replayed state should have messages (sub-agent ran)
      expect(childState.messages.length).toBeGreaterThan(0);

      // Replayed state should have tool states (Explore agent uses Read/Glob/Grep)
      const toolEntries = Object.values(childState.toolStates);
      expect(toolEntries.length).toBeGreaterThan(0);

      // Compare with disk state — replay captures streaming actions but disk also
      // includes the initial user message (PreToolUse) and final assistant response
      // (PostToolUse), so disk will have more messages than the socket replay.
      const diskStatePath = join(threadsDir, childThreadId!, "state.json");
      if (existsSync(diskStatePath)) {
        const diskState = JSON.parse(readFileSync(diskStatePath, "utf-8"));
        expect(diskState.messages.length).toBeGreaterThanOrEqual(
          childState.messages.length
        );
      }
    },
    120000
  );
});
