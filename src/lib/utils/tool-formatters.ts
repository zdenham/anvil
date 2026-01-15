/**
 * Human-friendly formatting for tool inputs.
 * Extracts key information from tool input objects for display.
 */

export interface FormattedToolInput {
  /** Primary display text (e.g., the command, file path, pattern) */
  primary: string;
  /** Optional secondary context */
  secondary?: string;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

/**
 * Format tool input for human-friendly display.
 * Returns a primary string (main content) and optional secondary context.
 */
export function formatToolInput(
  toolName: string,
  input: Record<string, unknown>
): FormattedToolInput {
  const name = toolName.toLowerCase();

  if (name === "bash") {
    const command = String(input.command || "");
    const description = input.description ? String(input.description) : undefined;
    return {
      primary: truncate(command, 100),
      secondary: description,
    };
  }

  if (name === "read") {
    return {
      primary: String(input.file_path || ""),
    };
  }

  if (name === "edit") {
    const filePath = String(input.file_path || "");
    const oldStr = String(input.old_string || "");
    return {
      primary: filePath,
      secondary: oldStr ? `"${truncate(oldStr, 40)}"` : undefined,
    };
  }

  if (name === "write") {
    return {
      primary: String(input.file_path || ""),
    };
  }

  if (name === "grep") {
    const pattern = String(input.pattern || "");
    const path = input.path ? String(input.path) : undefined;
    return {
      primary: pattern,
      secondary: path ? `in ${path}` : undefined,
    };
  }

  if (name === "glob") {
    const pattern = String(input.pattern || "");
    const path = input.path ? String(input.path) : undefined;
    return {
      primary: pattern,
      secondary: path ? `in ${path}` : undefined,
    };
  }

  if (name === "webfetch") {
    return {
      primary: String(input.url || ""),
    };
  }

  if (name === "websearch") {
    return {
      primary: String(input.query || ""),
    };
  }

  if (name === "task") {
    const description = input.description ? String(input.description) : undefined;
    const subagentType = input.subagent_type ? String(input.subagent_type) : undefined;
    return {
      primary: description || subagentType || "Task",
      secondary: subagentType && description ? subagentType : undefined,
    };
  }

  if (name === "todowrite") {
    const todos = input.todos as Array<{ content: string }> | undefined;
    if (todos && todos.length > 0) {
      return {
        primary: `${todos.length} item${todos.length > 1 ? "s" : ""}`,
      };
    }
    return { primary: "Update todos" };
  }

  if (name === "lsp") {
    const operation = String(input.operation || "");
    const filePath = String(input.filePath || "");
    return {
      primary: operation,
      secondary: filePath,
    };
  }

  // Fallback: try to find a meaningful first string property
  const firstStringValue = Object.values(input).find(
    (v) => typeof v === "string" && v.length > 0
  ) as string | undefined;

  if (firstStringValue) {
    return { primary: truncate(firstStringValue, 80) };
  }

  // Last resort: stringified JSON
  return { primary: JSON.stringify(input, null, 2) };
}
