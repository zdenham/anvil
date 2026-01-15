import type { ParsedDiffFile } from "./diff-parser";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".scala",
  ".vue",
  ".svelte",
]);

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.(go|py|rb)$/,
  /Test\.java$/,
  /tests?\//i,
];

const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".env",
  ".config.js",
  ".config.ts",
  ".eslintrc",
  ".prettierrc",
]);

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  return lastDot >= 0 ? path.slice(lastDot) : "";
}

export function isTestFile(path: string | null): boolean {
  if (!path) return false;
  return TEST_PATTERNS.some((pattern) => pattern.test(path));
}

export function isSourceFile(path: string | null): boolean {
  if (!path) return false;
  const ext = getExtension(path);
  return SOURCE_EXTENSIONS.has(ext) && !isTestFile(path);
}

export function isConfigFile(path: string | null): boolean {
  if (!path) return false;
  const ext = getExtension(path);
  return CONFIG_EXTENSIONS.has(ext) || path.includes("config");
}

export function calculatePriority(file: ParsedDiffFile): number {
  let score = 0;
  const path = file.newPath ?? file.oldPath; // Use oldPath for deleted files

  // More changes = higher priority
  score += file.stats.additions * 2;
  score += file.stats.deletions * 1.5;

  // Source files > config/docs
  if (isSourceFile(path)) score += 50;
  if (isTestFile(path)) score += 30;
  if (isConfigFile(path)) score += 10;

  // New files are interesting
  if (file.type === "added") score += 25;

  // Deleted files less interesting than modifications
  if (file.type === "deleted") score -= 10;

  return score;
}

export function prioritizeDiffs(files: ParsedDiffFile[]): ParsedDiffFile[] {
  return [...files].sort((a, b) => calculatePriority(b) - calculatePriority(a));
}
