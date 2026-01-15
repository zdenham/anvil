/**
 * Maps file extensions to Shiki language identifiers for syntax highlighting.
 */

const extensionToLanguage: Record<string, string> = {
  // TypeScript/JavaScript
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",

  // Systems languages
  ".rs": "rust",
  ".go": "go",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",

  // Scripting
  ".py": "python",
  ".rb": "ruby",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",

  // Web
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".vue": "vue",
  ".svelte": "svelte",

  // Data formats
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",

  // Documentation
  ".md": "markdown",
  ".mdx": "mdx",

  // Config files
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".dockerfile": "dockerfile",

  // Other
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".php": "php",
  ".cs": "csharp",
  ".fs": "fsharp",
};

/**
 * Detects the programming language from a file path.
 * Returns a Shiki-compatible language identifier.
 */
export function detectLanguage(filePath: string): string {
  if (!filePath) {
    return "plaintext";
  }

  // Handle special filenames without extensions
  const filename = filePath.split("/").pop() || "";
  const lowerFilename = filename.toLowerCase();

  if (lowerFilename === "dockerfile") {
    return "dockerfile";
  }
  if (lowerFilename === "makefile" || lowerFilename === "gnumakefile") {
    return "makefile";
  }

  // Extract extension (including the dot)
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return "plaintext";
  }

  const extension = filename.slice(lastDotIndex).toLowerCase();
  return extensionToLanguage[extension] || "plaintext";
}
