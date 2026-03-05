import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useToolState } from "@/hooks/use-tool-state";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { Zap } from "lucide-react";
import type { ToolBlockProps } from "./index";

/**
 * Input shape for the Skill tool.
 * This is cast from ToolUseBlock.input (which is typed as `unknown`).
 */
interface SkillInput {
  skill: string; // Skill name (e.g., "commit", "pdf", "review-pr")
  args?: string; // Optional arguments as a string
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300; // pixels

/**
 * Parse skill result from the tool_result content.
 *
 * The result string comes from ToolResultBlockParam.content.
 * For Skill tools, this is typically:
 * - Plain text describing what the skill did
 * - Status messages (e.g., "Skill 'commit' executed successfully")
 * - Error messages if is_error is true
 *
 * We do NOT parse as JSON - skills return human-readable text.
 */
function parseSkillResult(result: string | undefined): string {
  if (!result) {
    return "";
  }
  // Return as-is - skill output is already human-readable
  return result;
}

/**
 * Specialized block for rendering Skill tool calls.
 * Displays skill name, arguments, and execution output in a clean format.
 */
export function SkillToolBlock({
  id,
  name: _name,
  input,
  threadId,
}: ToolBlockProps) {
  const { status, result, isError } = useToolState(threadId, id);

  // Tool expand state
  const isExpanded = useToolExpandStore((state) =>
    state.isToolExpanded(threadId, id)
  );
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) =>
    setToolExpanded(threadId, id, expanded);

  // Parse input
  const skillInput = input as unknown as SkillInput;
  const skillName = skillInput.skill || "unknown";
  const args = skillInput.args;

  // Parse result - plain text, not JSON
  const output = parseSkillResult(result);
  const outputLines = output ? output.split("\n") : [];
  const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;

  // Output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) =>
    setOutputExpanded(threadId, id, expanded);

  const isRunning = status === "running";
  const hasOutput = output.length > 0;

  // Determine what to show on second line (command)
  const commandText = args || skillName;

  return (
    <div
      className="group py-0.5"
      aria-label={`Skill: ${skillName}, status: ${status}`}
      data-testid={`skill-tool-${id}`}
      data-tool-status={status}
    >
      {/* Collapsed/Summary Row */}
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
        {/* First line: Description text with shimmer (NO icon - chevron is here) */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          {/* NO icon on first line - chevron occupies that position */}
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {skillName}
          </ShimmerText>

          <CopyButton text={skillName} label="Copy skill name" alwaysVisible />

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          <span className="flex items-center gap-2 shrink-0 ml-auto" />
        </div>

        {/* Second line: Command/details with icon (icon ONLY appears here) */}
        <div className="flex items-center gap-1 mt-0.5">
          <Zap className="w-3 h-3 text-yellow-400/60 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 truncate min-w-0 flex-1">
            {commandText}
          </code>
          <CopyButton text={commandText} label="Copy command" alwaysVisible className="ml-auto" />
        </div>
      </div>

      {/* Expanded Output */}
      {isExpanded && hasOutput && (
        <div className="relative mt-2">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={output} label="Copy output" />
          </div>
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <pre
              className={cn(
                "text-xs font-mono p-2",
                "whitespace-pre-wrap break-words",
                isError ? "text-red-200" : "text-zinc-300"
              )}
            >
              <code>{output}</code>
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </pre>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Expanded but no output yet (running) */}
      {isExpanded && !hasOutput && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Running skill...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Skill running"
          : isError
            ? "Skill failed"
            : "Skill completed successfully"}
      </span>
    </div>
  );
}
