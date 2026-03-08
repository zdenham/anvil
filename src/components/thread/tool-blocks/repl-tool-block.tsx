import { memo } from "react";
import { cn } from "@/lib/utils";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { useCodeHighlight } from "@/hooks/use-code-highlight";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { Code } from "lucide-react";
import type { ThemedToken } from "@/lib/syntax-highlighter";

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

const HEREDOC_PATTERN = /mort-repl\s+<<['"]?(\w+)['"]?\n([\s\S]*?)\n\1/;
const QUOTED_PATTERN = /mort-repl\s+['"]?([\s\S]*?)['"]?\s*$/;

/** Extract TypeScript code body from a mort-repl command string. */
export function extractReplCode(command: string): string | null {
  const trimmed = command.trimStart();
  if (!trimmed.startsWith("mort-repl")) return null;
  const heredoc = trimmed.match(HEREDOC_PATTERN);
  if (heredoc) return heredoc[2];
  const quoted = trimmed.match(QUOTED_PATTERN);
  if (quoted) return quoted[1];
  return null;
}

/** Strip the mort-repl prefix from result text and detect repl-level errors. */
export function stripReplPrefix(result: string | undefined): {
  text: string;
  isReplError: boolean;
} {
  if (!result) return { text: "", isReplError: false };
  if (result.startsWith("mort-repl error:\n")) {
    return { text: result.slice("mort-repl error:\n".length), isReplError: true };
  }
  if (result.startsWith("mort-repl result:\n")) {
    return { text: result.slice("mort-repl result:\n".length), isReplError: false };
  }
  return { text: result, isReplError: false };
}

// --- Rendering subcomponents ---

const PlainCode = memo(function PlainCode({ code }: { code: string }) {
  return (
    <>
      {code.split("\n").map((line, i) => (
        <div key={i} className="whitespace-pre">
          {line.length === 0 ? <span>&nbsp;</span> : <span className="text-zinc-300">{line}</span>}
        </div>
      ))}
    </>
  );
});

const HighlightedCode = memo(function HighlightedCode({ tokens }: { tokens: ThemedToken[][] }) {
  return (
    <>
      {tokens.map((line, i) => (
        <div key={i} className="whitespace-pre">
          {line.length === 0 ? (
            <span>&nbsp;</span>
          ) : (
            line.map((token, j) => (
              <span key={j} style={{ color: token.color }}>
                {token.content}
              </span>
            ))
          )}
        </div>
      ))}
    </>
  );
});

interface ReplToolBlockProps {
  id: string;
  threadId: string;
  code: string;
  result: string | undefined;
  isRunning: boolean;
}

/**
 * Renders a mort-repl tool call with syntax-highlighted TypeScript code
 * and cleaned-up result output (no error styling for successful repl results).
 */
export function ReplToolBlock({ id, threadId, code, result, isRunning }: ReplToolBlockProps) {
  const isExpanded = useToolExpandStore((s) => s.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((s) => s.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const { tokens, isLoading } = useCodeHighlight(code, "typescript");
  const { text: outputText, isReplError } = stripReplPrefix(result);

  const hasOutput = outputText.length > 0;
  const outputLines = hasOutput ? outputText.split("\n") : [];
  const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;

  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((s) =>
    s.isOutputExpanded(threadId, id, defaultOutputExpanded),
  );
  const setOutputExpanded = useToolExpandStore((s) => s.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`mort-repl execution, status: ${isRunning ? "running" : "complete"}`}
      data-testid={`repl-tool-${id}`}
      data-tool-status={isRunning ? "running" : "complete"}
    >
      {/* Summary row */}
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
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            mort-repl
          </ShimmerText>
          {!isRunning && isReplError && (
            <span className="text-xs text-red-400">error</span>
          )}
        </div>

        {/* Line 2: Code icon + first line preview */}
        <div className="flex items-center gap-1 mt-0.5">
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <Code className="w-3 h-3 text-purple-400/60 shrink-0" />
            <span className="truncate">{code.split("\n")[0]}</span>
          </code>
          <CopyButton text={code} label="Copy code" alwaysVisible className="ml-auto" />
        </div>
      </div>

      {/* Expanded: syntax-highlighted code */}
      {isExpanded && (
        <div className="mt-2 rounded border border-zinc-700/50 overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-800 bg-zinc-900/50">
            <span className="text-xs text-zinc-400 font-mono">typescript</span>
            <CopyButton text={code} label="Copy code" />
          </div>
          <div className="overflow-x-auto p-2 font-mono text-sm bg-zinc-900/30">
            <code>
              {isLoading || !tokens ? (
                <PlainCode code={code} />
              ) : (
                <HighlightedCode tokens={tokens} />
              )}
            </code>
          </div>
        </div>
      )}

      {/* Expanded: result output */}
      {isExpanded && hasOutput && (
        <div data-testid={`repl-output-${id}`} className="relative mt-2">
          <div className="absolute top-1 right-1 z-10">
            <CopyButton text={outputText} label="Copy output" />
          </div>
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongOutput}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isReplError ? "error" : "default"}
          >
            <pre
              className={cn(
                "text-xs font-mono p-2",
                "whitespace-pre-wrap break-words",
                isReplError ? "text-red-200" : "text-zinc-300",
              )}
            >
              <code>{outputText}</code>
              {isRunning && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </pre>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Running with no output yet */}
      {isExpanded && !hasOutput && isRunning && (
        <div className="mt-2">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Running...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      <span className="sr-only">
        {isRunning ? "REPL code running" : isReplError ? "REPL code failed" : "REPL code completed successfully"}
      </span>
    </div>
  );
}
