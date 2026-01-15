import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { NodePersistence } from "../lib/persistence-node.js";
import { logger } from "../lib/logger.js";

export const humanReviewValidator: AgentValidator = {
  name: "human-review",

  async validate(context: ValidationContext): Promise<ValidationResult> {
    // Merge agent doesn't require human review
    if (context.agentType === "merge") {
      return { valid: true };
    }

    // Skip if no task (ephemeral conversation)
    if (!context.taskId) {
      return { valid: true };
    }

    // Fail-closed: missing threadId is an internal error, not a pass
    if (!context.threadId) {
      logger.debug("human-review-validator", "Missing threadId in validation context", {
        taskId: context.taskId,
        agentType: context.agentType,
      });
      return {
        valid: false,
        systemMessage: "INTERNAL ERROR: Thread ID missing from validation context",
      };
    }

    const persistence = new NodePersistence(context.mortDir);
    const task = await persistence.getTask(context.taskId);

    if (!task) {
      logger.debug("human-review-validator", "Task not found", {
        taskId: context.taskId,
      });
      return { valid: true };
    }

    // Check if CURRENT thread has requested review (not addressed)
    // NOTE: Remove optional chaining on pendingReviews after types migration is complete
    const currentThreadReview = task.pendingReviews?.find(
      (r) => r.threadId === context.threadId && !r.isAddressed
    );

    if (currentThreadReview) {
      return { valid: true };
    }

    logger.debug("human-review-validator", "Validation failed - no pending review for thread", {
      taskId: context.taskId,
      threadId: context.threadId,
      pendingReviewCount: task.pendingReviews?.length ?? 0,
    });

    return {
      valid: false,
      systemMessage: `VALIDATION FAILED: You must request human review before completing. Use the \`mort request-human\` command to request review of your work. This is required for all agents.`,
    };
  },
};
