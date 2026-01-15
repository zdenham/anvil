export interface ValidationResult {
  valid: boolean;
  /** System message to inject if validation fails */
  systemMessage?: string;
}

export interface ValidationContext {
  agentType: string;
  taskId: string | null;
  threadId: string | null;  // Current thread ID for review validation
  mortDir: string;
  cwd: string;
}

export interface AgentValidator {
  /** Human-readable name for logging */
  name: string;
  /** Which agent types this validator applies to (empty = all) */
  agentTypes?: string[];
  /** Run validation, return result */
  validate(context: ValidationContext): Promise<ValidationResult>;
}
