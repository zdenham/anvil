import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { logger } from "../lib/logger.js";

export * from "./types.js";

const validators: AgentValidator[] = [];

/**
 * Run all applicable validators for the given context.
 * Returns first failing validation, or { valid: true } if all pass.
 */
export async function runValidators(
  context: ValidationContext
): Promise<ValidationResult> {
  for (const validator of validators) {
    // Skip validators not applicable to this agent type
    if (
      validator.agentTypes &&
      validator.agentTypes.length > 0 &&
      !validator.agentTypes.includes(context.agentType)
    ) {
      continue;
    }

    logger.debug(`[validator] Running ${validator.name} for ${context.agentType}`);
    const result = await validator.validate(context);

    if (!result.valid) {
      logger.warn(`[validator] ${validator.name} FAILED`);
      return result;
    }

    logger.debug(`[validator] ${validator.name} PASSED`);
  }

  return { valid: true };
}
