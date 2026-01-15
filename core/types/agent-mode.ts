/**
 * Agent interaction mode - controls how the agent handles file edits.
 * - normal: Requires user approval for file edits
 * - plan: Agent plans actions but does not execute them
 * - auto-accept: Auto-approves all file edits
 */
export type AgentMode = "normal" | "plan" | "auto-accept";
