import { useState, useEffect, useCallback } from "react";
import { Copy, Check, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCodeHighlight } from "@/hooks/use-code-highlight";
import type { ThemedToken } from "@/lib/syntax-highlighter";

const LINE_COLLAPSE_THRESHOLD = 20;
const COPY_FEEDBACK_MS = 2000;

interface CodeBlockProps {
  code: string;
  language?: string;
  isStreaming?: boolean;
  className?: string;
}

function CopyButton({ code, isCopied, onCopy }: {
  code: string;
  isCopied: boolean;
  onCopy: () => void;
}) {
  const handleClick = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    onCopy();
  }, [code, onCopy]);

  return (
    <button
      onClick={handleClick}
      className={cn(
        "p-1.5 rounded transition-colors",
        isCopied
          ? "text-green-400"
          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
      )}
      aria-label={isCopied ? "Copied to clipboard" : "Copy code to clipboard"}
    >
      {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function HighlightedCode({ tokens }: { tokens: ThemedToken[][] }) {
  return (
    <>
      {tokens.map((line, lineIndex) => (
        <div key={lineIndex} className="whitespace-pre">
          {line.length === 0 ? (
            <span>&nbsp;</span>
          ) : (
            line.map((token, tokenIndex) => (
              <span key={tokenIndex} style={{ color: token.color }}>
                {token.content}
              </span>
            ))
          )}
        </div>
      ))}
    </>
  );
}

function CollapsedOverlay({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-zinc-900 to-transparent flex items-end justify-center pb-3">
      <button
        onClick={onExpand}
        className="flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
      >
        <ChevronDown className="h-4 w-4" />
        Expand
      </button>
    </div>
  );
}

function CollapseToggle({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button
      onClick={onCollapse}
      className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
      aria-label="Collapse code block"
    >
      <ChevronUp className="h-4 w-4" />
    </button>
  );
}

export function CodeBlock({ code, language = "plaintext", className }: CodeBlockProps) {
  const lineCount = code.split("\n").length;
  const isLongCode = lineCount > LINE_COLLAPSE_THRESHOLD;

  const [isExpanded, setIsExpanded] = useState(!isLongCode);
  const [isCopied, setIsCopied] = useState(false);

  const { tokens, isLoading } = useCodeHighlight(code, language);

  const handleCopy = useCallback(() => {
    setIsCopied(true);
  }, []);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  return (
    <div
      data-code-block
      tabIndex={0}
      className={cn(
        "relative group rounded-lg border border-zinc-800 bg-zinc-900",
        "focus:outline-none focus:ring-2 focus:ring-amber-500/50",
        "focus:ring-offset-2 focus:ring-offset-zinc-900",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs text-zinc-400 font-mono">{language}</span>
        <div className="flex items-center gap-1">
          {isExpanded && isLongCode && (
            <CollapseToggle onCollapse={() => setIsExpanded(false)} />
          )}
          <CopyButton code={code} isCopied={isCopied} onCopy={handleCopy} />
        </div>
      </div>

      {/* Code content */}
      <div
        className={cn(
          "overflow-x-auto p-3 font-mono text-sm",
          !isExpanded && isLongCode && "max-h-[400px] overflow-hidden"
        )}
      >
        <code>
          {isLoading || !tokens ? (
            <pre className="text-zinc-300 whitespace-pre">{code}</pre>
          ) : (
            <HighlightedCode tokens={tokens} />
          )}
        </code>
      </div>

      {/* Collapsed overlay */}
      {!isExpanded && isLongCode && (
        <CollapsedOverlay onExpand={() => setIsExpanded(true)} />
      )}
    </div>
  );
}
