import type {
  PermissionConfig,
  PermissionModeDefinition,
  PermissionModeId,
  PermissionRule,
  EvaluatorDecision,
} from "@core/types/permissions.js";

export interface EvaluatorResult {
  decision: EvaluatorDecision;
  reason: string;
}

/** Safety overrides that cannot be bypassed by any mode */
export const GLOBAL_OVERRIDES: PermissionRule[] = [
  {
    toolPattern: "^Bash$",
    commandPattern: "rm\\s+(-rf|--force).*\\.git",
    decision: "deny",
    reason: "Safety override: cannot delete .git directory. This is a global protection that cannot be bypassed in any mode.",
  },
  {
    toolPattern: "^(Write|Edit)$",
    pathPattern: "\\.env",
    decision: "deny",
    reason: "Safety override: cannot modify .env files. This is a global protection that cannot be bypassed in any mode.",
  },
  {
    toolPattern: "^EnterWorktree$",
    decision: "deny",
    reason: "Worktree creation is managed by Anvil. Use the Bash tool with `git worktree add` if you need a worktree, or ask the user to create one from the sidebar.",
  },
  {
    toolPattern: "^(Mcp|ListMcpResources|ReadMcpResource|SubscribeMcpResource|UnsubscribeMcpResource|SubscribePolling|UnsubscribePolling)$",
    decision: "deny",
    reason: "MCP is not supported. Do not attempt to use MCP tools.",
  },
];

// ── Helpers ────────────────────────────────────────────────────────

function normalizeToRelativePath(
  absolutePath: string,
  workingDirectory: string,
): string {
  if (absolutePath.startsWith(workingDirectory)) {
    return absolutePath.slice(workingDirectory.length).replace(/^\//, "");
  }
  return absolutePath;
}

function extractFilePath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const obj = toolInput as Record<string, unknown>;
  if (typeof obj.file_path === "string") return obj.file_path;
  if (typeof obj.path === "string") return obj.path;
  if (typeof obj.pattern === "string") return obj.pattern;
  return undefined;
}

function extractCommand(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const obj = toolInput as Record<string, unknown>;
  return typeof obj.command === "string" ? obj.command : undefined;
}

function matchesRule(
  rule: PermissionRule,
  toolName: string,
  filePath: string | undefined,
  command: string | undefined,
): boolean {
  if (!new RegExp(rule.toolPattern).test(toolName)) return false;

  if (rule.pathPattern !== undefined) {
    if (filePath === undefined) return false;
    if (!new RegExp(rule.pathPattern).test(filePath)) return false;
  }

  if (rule.commandPattern !== undefined) {
    if (command === undefined) return false;
    if (!new RegExp(rule.commandPattern).test(command)) return false;
  }

  return true;
}

// ── Evaluator ──────────────────────────────────────────────────────

/**
 * Pure-logic rules engine that decides allow/deny/ask for each tool call.
 *
 * Evaluation order:
 * 1. Global overrides (first match wins)
 * 2. Mode rules (first match wins)
 * 3. Mode default decision
 */
export class PermissionEvaluator {
  private overrides: PermissionRule[];
  private mode: PermissionModeDefinition;
  private workingDirectory: string;

  constructor(config: PermissionConfig) {
    this.overrides = [...GLOBAL_OVERRIDES, ...config.overrides];
    this.mode = config.mode;
    this.workingDirectory = config.workingDirectory;
  }

  /** Swap the active mode mid-run. Override rules are unaffected. */
  setMode(mode: PermissionModeDefinition): void {
    this.mode = mode;
  }

  /** Get the current mode ID */
  getModeId(): PermissionModeId {
    return this.mode.id;
  }

  /** Evaluate a tool call against overrides -> mode rules -> default */
  evaluate(toolName: string, toolInput: unknown): EvaluatorResult {
    const rawPath = extractFilePath(toolInput);
    const filePath =
      rawPath !== undefined
        ? normalizeToRelativePath(rawPath, this.workingDirectory)
        : undefined;
    const command = extractCommand(toolInput);

    // 1. Global overrides (first match wins)
    for (const rule of this.overrides) {
      if (matchesRule(rule, toolName, filePath, command)) {
        return { decision: rule.decision, reason: rule.reason ?? "override" };
      }
    }

    // 2. Mode rules (first match wins)
    for (const rule of this.mode.rules) {
      if (matchesRule(rule, toolName, filePath, command)) {
        return {
          decision: rule.decision,
          reason: rule.reason ?? `${this.mode.name} mode rule`,
        };
      }
    }

    // 3. Mode default
    return {
      decision: this.mode.defaultDecision,
      reason: `${this.mode.name} mode: "${toolName}" is not in the allowed tool list. ${this.mode.description}.`,
    };
  }
}
