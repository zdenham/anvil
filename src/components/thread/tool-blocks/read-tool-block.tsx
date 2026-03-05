import { toRelativePath } from "@/lib/utils/path-display";
import { getLanguageFromPath } from "@/lib/language-detection";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { useWorkspaceRoot } from "@/hooks/use-workspace-root";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CodeBlock } from "../code-block";
import { FileText } from "lucide-react";
import type { ToolBlockProps } from "./index";

/**
 * Claude Code's Read tool input shape.
 * Matches the input parameter passed to the Read tool.
 */
interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

/**
 * Extract actual file content from the Read tool result.
 * The result may be raw JSON with a nested structure like:
 * {"type":"text","file":{"filePath":"...","content":"...",...}}
 */
function extractFileContent(result: string): string {
  try {
    const parsed = JSON.parse(result);
    // Handle {"type":"text","file":{"content":"..."}} format
    if (parsed?.type === "text" && parsed?.file?.content) {
      return parsed.file.content;
    }
    // Handle direct {"content":"..."} format
    if (parsed?.content && typeof parsed.content === "string") {
      return parsed.content;
    }
    // Handle {"file":{"content":"..."}} format
    if (parsed?.file?.content) {
      return parsed.file.content;
    }
    // Not a recognized JSON format, return as-is
    return result;
  } catch {
    // Not valid JSON, return as-is (plain text content)
    return result;
  }
}

/**
 * Specialized block for rendering Read tool calls.
 * Displays file path in a two-line layout with expand/collapse functionality.
 */
export function ReadToolBlock({
  id,
  name: _name,
  input,
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Persist expand state across virtualization
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Get workspace root for relative path display
  const workspaceRoot = useWorkspaceRoot();

  // Extract input parameters
  const readInput = input as unknown as ReadInput;
  const filePath = readInput.file_path || "";
  const fileName = filePath.split('/').pop() || filePath;
  const displayPath = toRelativePath(filePath, workspaceRoot);

  const isRunning = status === "running";

  // Build header content (contains BOTH lines - first line is description, second line is command/details)
  const header = (
    <>
      {/* First line: Description with chevron (NO icon - chevron controls expand/collapse) */}
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <ShimmerText
          isShimmering={isRunning}
          className="text-sm text-zinc-200 truncate"
        >
          {isRunning ? `Reading ${fileName}` : `Read ${fileName}`}
        </ShimmerText>

        {/* Error indicator */}
        {!isRunning && isError && <StatusIcon isSuccess={false} />}

      </div>

      {/* Second line: File path with icon (icon ONLY on this line) */}
      <div className="flex items-center gap-1 mt-0.5">
        <FileText className="w-3 h-3 text-zinc-500/60 shrink-0" />
        <code className="text-xs font-mono text-zinc-400 truncate min-w-0 flex-1">
          {displayPath}
        </code>
        <CopyButton text={filePath} label="Copy file path" alwaysVisible className="ml-auto" />
      </div>
    </>
  );

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      testId={`read-tool-${id}`}
      ariaLabel={`Read file: ${filePath}, status: ${status}`}
      className="py-0.5"
      header={header}
    >
      {/* Expanded content: Error message if error, file content otherwise */}
      {isError && result && (
        <div className="mt-2 ml-6 text-xs text-red-400 font-mono">
          {result}
        </div>
      )}
      {!isError && result && (
        <div className="mt-2 ml-6">
          <CodeBlock
            code={extractFileContent(result)}
            language={getLanguageFromPath(filePath)}
          />
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Reading file"
          : isError
            ? "File read failed"
            : "File read complete"}
      </span>
    </CollapsibleBlock>
  );
}
