import { useState, useMemo } from "react";
import { Search, FileText } from "lucide-react";
import { toRelativePath } from "@/lib/utils/path-display";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { useWorkspaceRoot } from "@/hooks/use-workspace-root";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import type { ToolBlockProps } from "./index";

// ============================================================================
// Types
// ============================================================================

interface GrepInput {
  pattern: string;
  path?: string;
  type?: string;
  glob?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  "-i"?: boolean;
  "-n"?: boolean;
  "-C"?: number;
  "-A"?: number;
  "-B"?: number;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
}

interface ParsedGrepMatch {
  lineNumber: number;
  beforeContext: string[];
  line: string;
  afterContext: string[];
}

interface ParsedGrepFile {
  path: string;
  matchCount: number;
  matches: ParsedGrepMatch[];
}

interface ParsedGrepResult {
  pattern: string;
  outputMode: "content" | "files_with_matches" | "count";
  files: ParsedGrepFile[];
  totalMatches: number;
  totalFiles: number;
}

// ============================================================================
// Constants
// ============================================================================

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse files_with_matches mode output (just file paths, one per line)
 */
function parseFilesMode(lines: string[], pattern: string): ParsedGrepResult {
  const files = lines.map((path) => ({
    path: path.trim(),
    matchCount: 1,
    matches: [],
  }));

  return {
    pattern,
    outputMode: "files_with_matches",
    files,
    totalMatches: files.length,
    totalFiles: files.length,
  };
}

/**
 * Parse count mode output (file:count format)
 */
function parseCountMode(lines: string[], pattern: string): ParsedGrepResult {
  const files: ParsedGrepFile[] = [];
  let totalMatches = 0;

  for (const line of lines) {
    const match = line.match(/^(.+):(\d+)$/);
    if (match) {
      const count = parseInt(match[2], 10);
      files.push({
        path: match[1],
        matchCount: count,
        matches: [],
      });
      totalMatches += count;
    }
  }

  return {
    pattern,
    outputMode: "count",
    files,
    totalMatches,
    totalFiles: files.length,
  };
}

/**
 * Parse content mode output (file paths followed by line:content format)
 *
 * The format is:
 * filepath
 * linenum:content
 * linenum:content
 * --
 * filepath2
 * linenum:content
 */
function parseContentMode(lines: string[], pattern: string): ParsedGrepResult {
  const files: ParsedGrepFile[] = [];
  let currentFile: ParsedGrepFile | null = null;
  let totalMatches = 0;

  for (const line of lines) {
    // Skip separator lines
    if (line === "--") {
      continue;
    }

    // Check if this is a line with a line number (linenum:content or linenum-content for context)
    const lineMatch = line.match(/^(\d+)([-:])(.*)$/);

    if (lineMatch) {
      const lineNumber = parseInt(lineMatch[1], 10);
      const separator = lineMatch[2];
      const content = lineMatch[3];

      if (currentFile) {
        // Separator ':' indicates a match line, '-' indicates context
        if (separator === ":") {
          currentFile.matches.push({
            lineNumber,
            beforeContext: [],
            line: content,
            afterContext: [],
          });
          currentFile.matchCount++;
          totalMatches++;
        } else if (separator === "-" && currentFile.matches.length > 0) {
          // Context line - add to the last match's afterContext
          const lastMatch = currentFile.matches[currentFile.matches.length - 1];
          lastMatch.afterContext.push(`${lineNumber}: ${content}`);
        } else if (separator === "-") {
          // Context line before any match - store it for the next match
          // For simplicity, we'll skip these or handle them differently
        }
      }
    } else if (line.trim() && !line.startsWith(" ")) {
      // This looks like a file path - start a new file section
      // But first, handle the more common format: filepath:linenum:content
      const fullLineMatch = line.match(/^(.+?):(\d+):(.*)$/);
      if (fullLineMatch) {
        const filePath = fullLineMatch[1];
        const lineNumber = parseInt(fullLineMatch[2], 10);
        const content = fullLineMatch[3];

        // Find or create file entry
        let file = files.find((f) => f.path === filePath);
        if (!file) {
          file = { path: filePath, matchCount: 0, matches: [] };
          files.push(file);
          currentFile = file;
        } else {
          currentFile = file;
        }

        currentFile.matches.push({
          lineNumber,
          beforeContext: [],
          line: content,
          afterContext: [],
        });
        currentFile.matchCount++;
        totalMatches++;
      } else {
        // Pure file path line (ripgrep grouped format)
        currentFile = { path: line.trim(), matchCount: 0, matches: [] };
        files.push(currentFile);
      }
    }
  }

  return {
    pattern,
    outputMode: "content",
    files,
    totalMatches,
    totalFiles: files.length,
  };
}

/**
 * Parse the raw grep result string into structured data for display.
 * Handles all three output modes: content, files_with_matches, count.
 */
function parseGrepResult(
  result: string | undefined,
  input: GrepInput
): ParsedGrepResult {
  const outputMode = input.output_mode ?? "files_with_matches";

  if (!result) {
    return {
      pattern: input.pattern,
      outputMode,
      files: [],
      totalMatches: 0,
      totalFiles: 0,
    };
  }

  // Try to parse as JSON first (new format from tool)
  try {
    const json = JSON.parse(result);
    if (json && Array.isArray(json.filenames)) {
      // Handle JSON format: {"mode":"files_with_matches","filenames":[...],"numFiles":17}
      const files = json.filenames.map((path: string) => ({
        path,
        matchCount: 1,
        matches: [],
      }));
      return {
        pattern: input.pattern,
        outputMode: json.mode || outputMode,
        files,
        totalMatches: files.length,
        totalFiles: files.length,
      };
    }
  } catch {
    // Not JSON, continue with existing line-based parsing
  }

  const lines = result.split("\n").filter((l) => l.trim());

  switch (outputMode) {
    case "files_with_matches":
      return parseFilesMode(lines, input.pattern);
    case "count":
      return parseCountMode(lines, input.pattern);
    default:
      return parseContentMode(lines, input.pattern);
  }
}

// ============================================================================
// Highlighting Functions
// ============================================================================

/**
 * Highlight all occurrences of pattern in a line.
 * Returns JSX with <mark> elements for highlighted sections.
 */
function highlightPattern(
  line: string,
  pattern: string,
  isCaseSensitive: boolean
): React.ReactNode {
  try {
    const flags = isCaseSensitive ? "g" : "gi";
    const regex = new RegExp(pattern, flags);
    const parts: Array<{ text: string; isMatch: boolean }> = [];
    let lastIndex = 0;

    for (const match of line.matchAll(regex)) {
      if (match.index! > lastIndex) {
        parts.push({
          text: line.slice(lastIndex, match.index),
          isMatch: false,
        });
      }
      parts.push({ text: match[0], isMatch: true });
      lastIndex = match.index! + match[0].length;
    }

    if (lastIndex < line.length) {
      parts.push({ text: line.slice(lastIndex), isMatch: false });
    }

    // If no matches found, return original line
    if (parts.length === 0) {
      return line;
    }

    return (
      <>
        {parts.map((part, i) =>
          part.isMatch ? (
            <mark
              key={i}
              className="bg-yellow-200/30 text-yellow-100 rounded-sm px-0.5"
            >
              {part.text}
            </mark>
          ) : (
            <span key={i}>{part.text}</span>
          )
        )}
      </>
    );
  } catch {
    // Invalid regex, fall back to literal string match
    return line;
  }
}

// ============================================================================
// Summary Functions
// ============================================================================

/**
 * Generate a summary line describing the grep results.
 */
function getMatchSummary(parsed: ParsedGrepResult): string {
  const { pattern, totalMatches, totalFiles, outputMode } = parsed;
  const truncatedPattern =
    pattern.length > 30 ? pattern.slice(0, 30) + "..." : pattern;

  if (outputMode === "files_with_matches") {
    return `"${truncatedPattern}" → ${totalFiles} file${totalFiles !== 1 ? "s" : ""}`;
  }

  if (totalMatches === 0) {
    return `"${truncatedPattern}" → no matches`;
  }

  return `"${truncatedPattern}" → ${totalMatches} match${totalMatches !== 1 ? "es" : ""} in ${totalFiles} file${totalFiles !== 1 ? "s" : ""}`;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Specialized block for rendering Grep tool calls.
 * Displays search results with pattern highlighting and file grouping.
 */
export function GrepToolBlock({
  id,
  name: _name,
  input,
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Use Zustand store for expand state to persist across virtualization remounts
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, id)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId, id, expanded);

  // Get workspace root for relative path display
  const workspaceRoot = useWorkspaceRoot();

  const grepInput = input as unknown as GrepInput;
  const pattern = grepInput.pattern || "";
  const isCaseSensitive = !grepInput["-i"];

  // Parse the result string into structured data
  const parsed = parseGrepResult(result, grepInput);

  // Create a map of absolute paths to display paths for efficiency
  const displayPathMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of parsed.files) {
      map.set(file.path, toRelativePath(file.path, workspaceRoot));
    }
    return map;
  }, [parsed.files, workspaceRoot]);

  const isRunning = status === "running";
  const hasResults = parsed.totalMatches > 0 || parsed.totalFiles > 0;

  // Determine if results are long enough to need expand/collapse
  const totalMatchLines = parsed.files.reduce(
    (sum, f) => sum + f.matches.length,
    0
  );
  const isLongOutput =
    totalMatchLines > LINE_COLLAPSE_THRESHOLD ||
    parsed.files.length > LINE_COLLAPSE_THRESHOLD;

  // Use store for output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore(
    (state) => state.setOutputExpanded
  );
  const setIsOutputExpanded = (expanded: boolean) =>
    setOutputExpanded(threadId, id, expanded);

  // Per-file expand state (local, not persisted)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(parsed.files.map((f) => f.path))
  );

  function toggleFileExpanded(filePath: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }

  return (
    <div
      className="group py-0.5"
      aria-label={`Grep search: ${pattern}, status: ${status}`}
      data-testid={`grep-tool-${id}`}
      data-tool-status={status}
    >
      {/* Header - clickable to expand/collapse */}
      <div
        className="cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* Line 1: Chevron + Description (shimmer when running) + Duration */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            Search
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          <span className="flex items-center gap-2 shrink-0 ml-auto" />
        </div>

        {/* Line 2: Icon + Command/Details (pattern + match summary) */}
        <div className="flex items-center gap-1 mt-0.5">
          <Search className="w-3 h-3 text-zinc-500/60 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 min-w-0 flex-1 truncate">
            {getMatchSummary(parsed)}
          </code>
          <CopyButton text={pattern} label="Copy pattern" className="ml-auto" />
        </div>
      </div>

      {/* Expanded Results - Content Mode */}
      {isExpanded && hasResults && parsed.outputMode === "content" && (
        <div className="mt-2">
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <div className="p-2 space-y-3">
              {parsed.files.map((file) => (
                <CollapsibleBlock
                  key={file.path}
                  isExpanded={expandedFiles.has(file.path)}
                  onToggle={() => toggleFileExpanded(file.path)}
                  header={
                    <div className="flex items-center gap-2">
                      <ExpandChevron
                        isExpanded={expandedFiles.has(file.path)}
                        size="sm"
                      />
                      <code className="text-xs font-mono text-zinc-300 flex-1 min-w-0 truncate">
                        {displayPathMap.get(file.path) ?? file.path}
                      </code>
                      <span className="text-xs text-zinc-500 whitespace-nowrap">
                        {file.matchCount} match
                        {file.matchCount !== 1 ? "es" : ""}
                      </span>
                      <CopyButton text={file.path} label="Copy path" />
                    </div>
                  }
                >
                  {/* Matches within file */}
                  <div className="ml-4 mt-1 space-y-2 border-l border-zinc-700/50 pl-3">
                    {file.matches.map((match, idx) => (
                      <div key={idx} className="text-xs font-mono group/match">
                        {/* Context before */}
                        {match.beforeContext.map((line, i) => (
                          <div
                            key={`before-${i}`}
                            className="text-zinc-600 whitespace-pre-wrap break-words"
                          >
                            {line}
                          </div>
                        ))}

                        {/* Match line with highlighting */}
                        <div className="flex items-start gap-2">
                          <span className="text-zinc-600 select-none shrink-0 w-8 text-right">
                            {match.lineNumber}:
                          </span>
                          <span className="text-zinc-200 whitespace-pre-wrap break-words flex-1">
                            {highlightPattern(
                              match.line,
                              pattern,
                              isCaseSensitive
                            )}
                          </span>
                          <CopyButton text={match.line} label="Copy line" />
                        </div>

                        {/* Context after */}
                        {match.afterContext.map((line, i) => (
                          <div
                            key={`after-${i}`}
                            className="text-zinc-600 whitespace-pre-wrap break-words"
                          >
                            {line}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </CollapsibleBlock>
              ))}
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Expanded Results - Files Mode */}
      {isExpanded && hasResults && parsed.outputMode === "files_with_matches" && (
        <div className="mt-2">
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={parsed.files.length > LINE_COLLAPSE_THRESHOLD}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <div className="p-2 space-y-1">
              {parsed.files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 group/file"
                >
                  <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <code className="text-xs font-mono text-zinc-300 flex-1 min-w-0 truncate">
                    {displayPathMap.get(file.path) ?? file.path}
                  </code>
                  <CopyButton text={file.path} label="Copy path" />
                </div>
              ))}
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Expanded Results - Count Mode */}
      {isExpanded && hasResults && parsed.outputMode === "count" && (
        <div className="mt-2">
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={parsed.files.length > LINE_COLLAPSE_THRESHOLD}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <div className="p-2">
              <table className="w-full text-xs font-mono">
                <tbody>
                  {parsed.files.map((file) => (
                    <tr key={file.path} className="group/row">
                      <td className="text-zinc-300 pr-4 py-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{displayPathMap.get(file.path) ?? file.path}</span>
                          <CopyButton text={file.path} label="Copy path" />
                        </div>
                      </td>
                      <td className="text-zinc-500 text-right whitespace-nowrap py-0.5">
                        {file.matchCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-700/50">
                    <td className="text-zinc-400 font-medium pt-1">Total</td>
                    <td className="text-zinc-400 font-medium text-right pt-1">
                      {parsed.totalMatches}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Empty Results */}
      {isExpanded && !hasResults && !isRunning && (
        <div className="mt-2 text-xs text-zinc-500 italic px-2">
          No matches found for "{pattern}"
        </div>
      )}

      {/* Running State (No Results Yet) */}
      {isExpanded && !hasResults && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Searching...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Search running"
          : isError
            ? "Search failed"
            : "Search completed"}
      </span>
    </div>
  );
}
