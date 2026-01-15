import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { NodePersistence } from "../lib/persistence-node.js";

// Bad title patterns - too generic
const BAD_TITLE_PATTERNS = [
  /^draft$/i,
  /^untitled$/i,
  /^new task$/i,
  /^task$/i,
  /^work$/i,
  /^todo$/i,
  /^fix$/i,
  /^update$/i,
  /^change$/i,
  /^implement$/i,
];

export const researchNamingValidator: AgentValidator = {
  name: "research-naming",
  agentTypes: ["research"],

  async validate(context: ValidationContext): Promise<ValidationResult> {
    if (!context.taskId) {
      return { valid: true };
    }

    const persistence = new NodePersistence(context.mortDir);
    const task = await persistence.getTask(context.taskId);

    if (!task) {
      return { valid: true };
    }

    const title = task.title.trim();

    // Check for bad title patterns
    for (const pattern of BAD_TITLE_PATTERNS) {
      if (pattern.test(title)) {
        return {
          valid: false,
          systemMessage: `VALIDATION FAILED: The task title "${title}" is too generic. You must rename the task to something descriptive using \`mort tasks rename --id=${context.taskId} --title="Descriptive title here"\`. Good titles describe what the task accomplishes, e.g., "Add dark mode toggle to settings" or "Fix race condition in auth flow".`,
        };
      }
    }

    // Check minimum length
    if (title.length < 10) {
      return {
        valid: false,
        systemMessage: `VALIDATION FAILED: The task title "${title}" is too short. You must rename with a more descriptive title (at least 10 characters) using \`mort tasks rename --id=${context.taskId} --title="Descriptive title here"\`.`,
      };
    }

    // Check slug is valid
    const slug = task.slug;
    if (!slug || slug.length < 3) {
      return {
        valid: false,
        systemMessage: `VALIDATION FAILED: The task slug "${slug}" is too short. The title "${title}" doesn't generate a good slug. You must rename with a title containing meaningful words using \`mort tasks rename --id=${context.taskId} --title="Descriptive title here"\`.`,
      };
    }

    // Check if slug still has draft prefix (task was never renamed from initial draft state)
    if (slug.startsWith("draft-")) {
      return {
        valid: false,
        systemMessage: `VALIDATION FAILED: The task still has its draft name (slug: "${slug}"). You must rename the task to something descriptive using \`mort tasks rename --id=${context.taskId} --title="Descriptive title here"\`. Good titles describe what the task accomplishes, e.g., "Add dark mode toggle to settings" or "Fix race condition in auth flow".`,
      };
    }

    return { valid: true };
  },
};
