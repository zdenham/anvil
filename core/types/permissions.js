import { z } from "zod";
// Permission mode - when to prompt
export const PermissionModeSchema = z.enum([
    "ask-always", // Ask for every tool
    "ask-writes", // Ask for file/git writes only
    "allow-all", // No prompts (bypass)
]);
// Display mode - how to show the prompt
export const PermissionDisplayModeSchema = z.enum([
    "modal", // Centered dialog with backdrop
    "inline", // Embedded in thread view
]);
// Schema for validating permission requests from agent IPC (trust boundary)
export const PermissionRequestSchema = z.object({
    requestId: z.string(),
    threadId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()),
    timestamp: z.number(),
});
// Tools that modify files or git state (show warning styling)
export const DANGEROUS_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"];
export function isDangerousTool(toolName) {
    return DANGEROUS_TOOLS.includes(toolName);
}
// Alias for backward compatibility
export const WRITE_TOOLS = DANGEROUS_TOOLS;
export function isWriteTool(toolName) {
    return isDangerousTool(toolName);
}
/** Cycle order for Shift+Tab */
export const PERMISSION_MODE_CYCLE = ["implement", "plan", "approve"];
// ── Built-in Mode Definitions ───────────────────────────────────────
export const PLAN_MODE = {
    id: "plan",
    name: "Plan",
    description: "Can read everything, write only to plans/, Bash allowed",
    rules: [
        { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
        { toolPattern: "^Bash$", decision: "allow" },
        { toolPattern: "^Task$", decision: "allow" },
        { toolPattern: "^(Write|Edit|NotebookEdit)$", pathPattern: "^plans/", decision: "allow" },
        { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "deny", reason: "Plan mode: file writes are restricted to the plans/ directory. Move your output to plans/ or ask the user to switch to Implement mode." },
    ],
    defaultDecision: "deny",
};
export const IMPLEMENT_MODE = {
    id: "implement",
    name: "Implement",
    description: "All tools auto-approved",
    rules: [],
    defaultDecision: "allow",
};
export const APPROVE_MODE = {
    id: "approve",
    name: "Approve",
    description: "Read/Bash auto-approved, file edits require approval with diff preview",
    rules: [
        { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
        { toolPattern: "^Bash$", decision: "allow" },
        { toolPattern: "^Task$", decision: "allow" },
        { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "ask" },
    ],
    defaultDecision: "ask",
};
export const BUILTIN_MODES = {
    plan: PLAN_MODE,
    implement: IMPLEMENT_MODE,
    approve: APPROVE_MODE,
};
