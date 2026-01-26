// Turn grouping for thread rendering
export {
  groupMessagesIntoTurns,
  isTurnStreaming,
  getUserTurnPrompt,
  isToolResultOnlyTurn,
  getAssistantContent,
} from "./turn-grouping";
export type { Turn } from "./turn-grouping";

// Tool icon mapping
export { getToolIcon, getToolDisplayName } from "./tool-icons";
export type { ToolIconConfig } from "./tool-icons";

// File change utilities
export {
  buildFileChangesMap,
  getFileOperationIcon,
  getFileOperationLabel,
} from "./file-changes";

// Time formatting
export {
  formatRelativeTime,
  formatIsoTime,
  formatAbsoluteTime,
  formatDuration,
} from "./time-format";

// Diff extraction utilities
export {
  extractDiffFromToolResult,
  generateEditDiff,
  generateWriteDiff,
} from "./diff-extractor";
export type {
  ExtractedDiff,
  EditToolInput,
  WriteToolInput,
  GeneratedDiff,
} from "./diff-extractor";

// Test ID utilities
export function sanitizeTestId(path: string): string {
  return path.replace(/[^a-zA-Z0-9-]/g, "-");
}

// Path display utilities
export {
  initHomeDir,
  getHomeDir,
  toRelativePath,
  toFileName,
  toRelativePaths,
} from "./path-display";
