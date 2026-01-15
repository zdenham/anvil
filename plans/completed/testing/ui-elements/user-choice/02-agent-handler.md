# Phase 2: Agent-Side Handler

## Dependencies
- **Depends on:** `01-core-components.md` (components must exist first)
- **Blocks:** `04-testing.md`
- **Can run parallel with:** `03-ui-integration.md`

> **Note on Dependency Ordering:** While Phase 2 can technically start immediately since the frontend service code is independent of the React components, sequential ordering after Phase 1 ensures components are ready for end-to-end testing when the agent handler is complete. If you need to parallelize, Phase 2 and Phase 3 can run simultaneously after Phase 1.

## Scope

Add backend support for submitting tool results from interactive tools like AskUserQuestion. This allows the agent loop to pause, wait for user input, and resume.

**Important:** The agent runner code lives in the **Node.js agent process**, not the Rust backend. The Rust layer acts as a bridge, forwarding the tool result from the Tauri frontend to the Node agent process via IPC.

## Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `src/services/agent-service.ts` | **Verify file exists, then modify** | Add `submitToolResult` function |
| `src-tauri/src/commands/agent.rs` | **Verify file exists, then modify** | Add Tauri command to forward to Node agent |
| `agent/src/runner.ts` | **Verify file exists, then modify** | Handle tool result and resume agent loop |

---

## Step 2.1: Add submitToolResult to Agent Service

**File:** `src/services/agent-service.ts`

**Action:** Verify file exists at `src/services/agent-service.ts`, then add the following function.

Add a new function to submit tool results back to the agent runner.

### Function Signature

```typescript
/**
 * Submit a tool result to resume agent execution.
 * Used for interactive tools like AskUserQuestion.
 */
export async function submitToolResult(
  taskId: string,
  threadId: string,
  toolId: string,
  response: string,
  workingDirectory: string
): Promise<void>
```

### Implementation

```typescript
import { invoke } from "@tauri-apps/api/core";

export async function submitToolResult(
  taskId: string,
  threadId: string,
  toolId: string,
  response: string,
  workingDirectory: string
): Promise<void> {
  return invoke("submit_tool_result", {
    taskId,
    threadId,
    toolId,
    response,
    workingDirectory,
  });
}
```

---

## Step 2.2: Tauri Rust Command

**File:** `src-tauri/src/commands/agent.rs`

**Action:** Verify file exists at `src-tauri/src/commands/agent.rs`, then add the Tauri command.

The Rust backend **must** implement this command to forward the tool result to the Node agent process. This is not optional.

### Implementation

```rust
#[tauri::command]
pub async fn submit_tool_result(
    task_id: String,
    thread_id: String,
    tool_id: String,
    response: String,
    working_directory: String,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    // Forward to agent process via IPC
    state
        .send_to_agent(AgentMessage::ToolResult {
            task_id,
            thread_id,
            tool_id,
            response,
            working_directory,
        })
        .await
        .map_err(|e| e.to_string())
}
```

### Register the Command

In `src-tauri/src/lib.rs`, ensure the command is registered:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    commands::agent::submit_tool_result,
])
```

---

## Step 2.3: Agent Loop Detection and Pause

**File:** `agent/src/runner.ts`

**Action:** Verify file exists at `agent/src/runner.ts`, then add the detection and pause logic.

The agent runner (in the Node agent process) must detect when the model emits an AskUserQuestion tool_use block and pause execution until the user responds.

### Detection Logic

```typescript
/**
 * Check if a tool_use block requires user interaction.
 * Returns true for tools that should pause the agent loop.
 */
function isInteractiveTool(block: ToolUseBlock): boolean {
  return block.name === "AskUserQuestion";
}

/**
 * In the agent loop, after processing assistant response:
 */
async function processAssistantResponse(response: AssistantResponse): Promise<void> {
  for (const block of response.content) {
    if (block.type === "tool_use") {
      if (isInteractiveTool(block)) {
        // Emit the tool_use to UI for rendering
        this.emit("toolUse", {
          id: block.id,
          name: block.name,
          input: block.input,
          status: "awaiting_user",
        });

        // PAUSE: Do not continue the agent loop
        // The loop will resume when submitToolResult is called
        this.pendingInteractiveToolId = block.id;
        return; // Exit the loop, awaiting user input
      }

      // Regular tool execution continues...
    }
  }
}
```

---

## Step 2.4: Agent Runner Tool Result Handling

**File:** `agent/src/runner.ts`

**Action:** Verify file exists at `agent/src/runner.ts`, then add the handler.

The agent runner (in the Node agent process) handles incoming tool results.

### Required Behavior

1. **Detect AskUserQuestion tool_use blocks** - When the model emits this tool, pause execution
2. **Pause execution** - Wait for user input via an event or callback
3. **Accept tool results** - Receive the user's response via `submitToolResult`
4. **Construct proper tool_result message** - Per Anthropic API spec
5. **Resume agent loop** - Continue with the updated conversation

### Message Format

The tool result message must follow Anthropic's API structure:

```typescript
interface ToolResultMessage {
  role: "user";
  content: [{
    type: "tool_result";
    tool_use_id: string;
    content: string;
  }];
}
```

### Helper Function

```typescript
/**
 * Construct a proper tool_result message for the Anthropic API.
 */
function createToolResultMessage(toolId: string, response: string): ToolResultMessage {
  return {
    role: "user",
    content: [{
      type: "tool_result",
      tool_use_id: toolId,
      content: response,
    }],
  };
}
```

### Handler Implementation

```typescript
/**
 * Called when user responds to an interactive tool like AskUserQuestion.
 */
async submitToolResult(threadId: string, toolId: string, response: string): Promise<void> {
  // Verify this is the tool we're waiting for
  if (this.pendingInteractiveToolId !== toolId) {
    throw new Error(`Unexpected tool result for ${toolId}, expected ${this.pendingInteractiveToolId}`);
  }

  const toolResultMessage = createToolResultMessage(toolId, response);

  // Append to conversation history
  this.messages.push(toolResultMessage);

  // Update tool state to complete
  this.updateToolState(toolId, {
    status: "complete",
    result: response,
  });

  // Emit state change for UI
  this.emit("toolStateChange", { toolId, status: "complete", result: response });

  // Clear pending state
  this.pendingInteractiveToolId = null;

  // Resume the agent loop
  await this.runAgentLoop();
}
```

---

## Event Flow

```
User clicks option in UI
        |
        v
SimpleTaskWindow.handleToolResponse()
        |
        v
submitToolResult() -> Tauri invoke
        |
        v
Rust submit_tool_result command
        |
        v
IPC message to Node agent process
        |
        v
Agent runner receives tool result
        |
        v
Agent appends tool_result message to conversation
        |
        v
Agent resumes loop (calls API with updated messages)
        |
        v
UI receives updated state via event stream
```

---

## Verification

```bash
# Verify source files exist
ls -la src/services/agent-service.ts
ls -la src-tauri/src/commands/agent.rs
ls -la agent/src/runner.ts

# Type check frontend
pnpm tsc --noEmit

# Check agent service exports
grep -n "submitToolResult" src/services/agent-service.ts

# Build Rust backend
cd src-tauri && cargo check
```

---

## Exit Criteria

- [ ] `submitToolResult` function added to `src/services/agent-service.ts`
- [ ] Function uses proper Tauri invoke call
- [ ] Rust command `submit_tool_result` added to `src-tauri/src/commands/agent.rs`
- [ ] Rust command registered in `src-tauri/src/lib.rs`
- [ ] Agent runner in `agent/src/runner.ts` detects AskUserQuestion and pauses
- [ ] Agent runner handles tool result and resumes loop
- [ ] Type check passes for all modified files
- [ ] No unused imports or dead code
