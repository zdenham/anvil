# 01 - Status to Agent Mapping

## New File: `src/lib/agent-state-machine.ts`

This module maps task status to agent types and handles state transitions.

```typescript
import type { TaskStatus } from "@/entities/tasks/types";

/**
 * Map task status to the agent type that handles that phase.
 * Returns null if no agent should be spawned (task complete).
 */
export function getAgentTypeForStatus(status: TaskStatus): string | null {
  switch (status) {
    case "draft":
      return "entrypoint";
    case "in_progress":
      return "execution";
    case "completed":
      return "review";
    default:
      return null;
  }
}

/**
 * Get the next status in the workflow progression.
 * Returns the same status if already at terminal state.
 */
export function getNextStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case "draft":
      return "in_progress";
    case "in_progress":
      return "completed";
    case "completed":
      return "merged";
    default:
      return status;
  }
}

/**
 * Check if a status can progress to the next phase.
 */
export function canProgress(status: TaskStatus): boolean {
  return status === "draft" || status === "in_progress" || status === "completed";
}

/**
 * Determine if the user's response is a "default" response.
 *
 * Default = user pressed Enter without typing anything.
 * This triggers progression to the next status/agent.
 */
export function isDefaultResponse(inputValue: string): boolean {
  return inputValue.trim() === "";
}

/**
 * Get human-readable label for what the next phase is.
 */
export function getNextPhaseLabel(status: TaskStatus): string {
  switch (status) {
    case "draft":
      return "Implementation";
    case "in_progress":
      return "Code Review";
    case "completed":
      return "Complete";
    default:
      return "Done";
  }
}

/**
 * Get human-readable label for the current phase.
 */
export function getCurrentPhaseLabel(status: TaskStatus): string {
  switch (status) {
    case "draft":
      return "Research & Planning";
    case "in_progress":
      return "Implementation";
    case "completed":
      return "Code Review";
    case "merged":
      return "Complete";
    default:
      return status;
  }
}

/**
 * Determine the action to take based on user response.
 */
export type ResponseAction =
  | { type: "progress"; nextStatus: TaskStatus; agentType: string }
  | { type: "complete"; nextStatus: TaskStatus }
  | { type: "stay"; message: string };

export function determineResponseAction(
  currentStatus: TaskStatus,
  inputValue: string
): ResponseAction {
  if (isDefaultResponse(inputValue)) {
    const nextStatus = getNextStatus(currentStatus);
    const agentType = getAgentTypeForStatus(nextStatus);

    if (agentType === null) {
      return { type: "complete", nextStatus };
    }

    return { type: "progress", nextStatus, agentType };
  }

  // Custom feedback - stay in current status
  return { type: "stay", message: inputValue.trim() };
}
```

## Status Workflow Diagram

```
┌──────────┐     ┌─────────────┐     ┌───────────┐     ┌────────┐
│  draft   │────►│ in_progress │────►│ completed │────►│ merged │
└──────────┘     └─────────────┘     └───────────┘     └────────┘
     │                  │                  │
     │                  │                  │
     ▼                  ▼                  ▼
 entrypoint         execution           review
   agent              agent              agent
```

## Usage Example

```typescript
import {
  determineResponseAction,
  getNextPhaseLabel
} from "@/lib/agent-state-machine";

// When user submits a review response:
const action = determineResponseAction(task.status, inputValue);

switch (action.type) {
  case "progress":
    // Update status and spawn new agent
    await taskService.update(taskId, {
      status: action.nextStatus,
      pendingReview: null
    });
    await spawnAgent(taskId, action.agentType);
    break;

  case "complete":
    // Task is finished
    await taskService.update(taskId, {
      status: action.nextStatus,
      pendingReview: null
    });
    break;

  case "stay":
    // Resume current agent with feedback
    await taskService.update(taskId, { pendingReview: null });
    await resumeAgent(activeThreadId, action.message);
    break;
}
```

## Tests

```typescript
import {
  getAgentTypeForStatus,
  getNextStatus,
  isDefaultResponse,
  determineResponseAction,
} from "./agent-state-machine";

describe("agent-state-machine", () => {
  describe("getAgentTypeForStatus", () => {
    it("maps draft to entrypoint", () => {
      expect(getAgentTypeForStatus("draft")).toBe("entrypoint");
    });

    it("maps in_progress to execution", () => {
      expect(getAgentTypeForStatus("in_progress")).toBe("execution");
    });

    it("maps completed to review", () => {
      expect(getAgentTypeForStatus("completed")).toBe("review");
    });

    it("returns null for merged", () => {
      expect(getAgentTypeForStatus("merged")).toBeNull();
    });
  });

  describe("getNextStatus", () => {
    it("draft -> in_progress", () => {
      expect(getNextStatus("draft")).toBe("in_progress");
    });

    it("in_progress -> completed", () => {
      expect(getNextStatus("in_progress")).toBe("completed");
    });

    it("completed -> merged", () => {
      expect(getNextStatus("completed")).toBe("merged");
    });

    it("merged stays merged", () => {
      expect(getNextStatus("merged")).toBe("merged");
    });
  });

  describe("isDefaultResponse", () => {
    it("empty string is default", () => {
      expect(isDefaultResponse("")).toBe(true);
    });

    it("whitespace-only is default", () => {
      expect(isDefaultResponse("   ")).toBe(true);
    });

    it("any text is not default", () => {
      expect(isDefaultResponse("please add tests")).toBe(false);
    });
  });

  describe("determineResponseAction", () => {
    it("progresses from draft on default", () => {
      const action = determineResponseAction("draft", "");
      expect(action).toEqual({
        type: "progress",
        nextStatus: "in_progress",
        agentType: "execution",
      });
    });

    it("stays on custom feedback", () => {
      const action = determineResponseAction("in_progress", "add error handling");
      expect(action).toEqual({
        type: "stay",
        message: "add error handling",
      });
    });

    it("completes from completed status on default", () => {
      const action = determineResponseAction("completed", "");
      expect(action).toEqual({
        type: "complete",
        nextStatus: "merged",
      });
    });
  });
});
```
