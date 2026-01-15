export interface ToolIconConfig {
  icon: string;
  description: string;
}

const TOOL_ICON_PATTERNS: Array<{
  pattern: RegExp;
  config: ToolIconConfig;
}> = [
  {
    pattern: /^(read|Read)/i,
    config: { icon: "file-text", description: "File read" },
  },
  {
    pattern: /^(write|Write|edit|Edit)/i,
    config: { icon: "pencil", description: "File write" },
  },
  {
    pattern: /^(bash|Bash)/i,
    config: { icon: "terminal", description: "Shell command" },
  },
  {
    pattern: /^(search|Grep|Glob)/i,
    config: { icon: "search", description: "Search" },
  },
  {
    pattern: /^(web|WebFetch|WebSearch)/i,
    config: { icon: "globe", description: "Web request" },
  },
  {
    pattern: /^(Task)/i,
    config: { icon: "git-branch", description: "Subagent" },
  },
];

const DEFAULT_TOOL_ICON: ToolIconConfig = {
  icon: "wrench",
  description: "Tool",
};

/**
 * Get icon configuration for a tool by name.
 * Returns Lucide icon name and description.
 */
export function getToolIcon(toolName: string): ToolIconConfig {
  for (const { pattern, config } of TOOL_ICON_PATTERNS) {
    if (pattern.test(toolName)) {
      return config;
    }
  }
  return DEFAULT_TOOL_ICON;
}

/**
 * Get display name for a tool (cleaned up for UI).
 */
export function getToolDisplayName(toolName: string): string {
  // Remove common prefixes/suffixes, capitalize
  return toolName
    .replace(/^(tool_|mcp_)/i, "")
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
