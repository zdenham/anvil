import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { NodePersistence } from "../lib/persistence-node.js";

export const mergeTaskStatusValidator: AgentValidator = {
  name: "merge-task-status",
  agentTypes: ["merge"],

  async validate(context: ValidationContext): Promise<ValidationResult> {
    // Skip if no task (ephemeral conversation)
    if (!context.taskId) {
      return { valid: true };
    }

    const persistence = new NodePersistence(context.mortDir);

    // Read task to check status
    const task = await persistence.getTask(context.taskId);
    if (!task) {
      return { valid: true };
    }

    // Merge agent requires task to be in final status
    if (task.status === "done") {
      return { valid: true };
    }

    return {
      valid: false,
      systemMessage: `VALIDATION FAILED: Merge agent cannot exit until task status is 'done'. Current status: '${task.status}'. Use \`mort tasks update --id=${context.taskId} --status=done\` to mark the task as done.`,
    };
  },
};
