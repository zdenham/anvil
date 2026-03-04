import { useState, useEffect, useCallback, memo } from "react";
import { Copy, Check, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCodeHighlight } from "@/hooks/use-code-highlight";
import type { ThemedToken } from "@/lib/syntax-highlighter";

const LINE_COLLAPSE_THRESHOLD = 20;
const COPY_FEEDBACK_MS = 2000;

// Persist expand state across remounts using content-based keys
// This survives component remounting when parent re-renders
const expandedStateCache = new Map<string, boolean>();
const MAX_CACHE_SIZE = 200;

function getExpandedStateKey(code: string, language: string): string {
  // Use first 100 chars + length as a quick identifier
  return `${language}:${code.length}:${code.slice(0, 100)}`;
}

// Exported for testing - clears the expand state cache
export function clearExpandedStateCache(): void {
  expandedStateCache.clear();
}

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
      data-testid="copy-button"
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

const HighlightedCode = memo(function HighlightedCode({ tokens }: { tokens: ThemedToken[][] }) {
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
});

function ExpandCollapseOverlay({ isExpanded, onToggle }: { isExpanded: boolean; onToggle: () => void }) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <div className={cn(
      "absolute bottom-0 left-0 right-0 flex items-end justify-center pb-3 pointer-events-none",
      !isExpanded && "h-24 bg-gradient-to-t from-zinc-900 to-transparent"
    )}>
      <button
        onClick={handleClick}
        className="flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors pointer-events-auto relative z-10"
        aria-label={isExpanded ? "Collapse code block" : "Expand code block"}
      >
        {isExpanded ? (
          <>
            <ChevronUp className="h-4 w-4" />
            Collapse
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4" />
            Expand
          </>
        )}
      </button>
    </div>
  );
}

export const CodeBlock = memo(function CodeBlock({ code, language = "plaintext", className }: CodeBlockProps) {
  const lineCount = code.split("\n").length;
  const isLongCode = lineCount > LINE_COLLAPSE_THRESHOLD;
  const stateKey = getExpandedStateKey(code, language);

  // Initialize from cache if available, otherwise default based on code length
  const [isExpanded, setIsExpanded] = useState(() => {
    const cached = expandedStateCache.get(stateKey);
    if (cached !== undefined) return cached;
    return !isLongCode;
  });
  const [isCopied, setIsCopied] = useState(false);

  const { tokens, isLoading } = useCodeHighlight(code, language);

  // Persist expand state changes to cache
  useEffect(() => {
    // Only cache if it differs from default (saves memory)
    const defaultValue = !isLongCode;
    if (isExpanded !== defaultValue) {
      // Simple LRU eviction
      if (expandedStateCache.size >= MAX_CACHE_SIZE) {
        const firstKey = expandedStateCache.keys().next().value;
        if (firstKey) expandedStateCache.delete(firstKey);
      }
      expandedStateCache.set(stateKey, isExpanded);
    } else {
      // Remove from cache if back to default
      expandedStateCache.delete(stateKey);
    }
  }, [isExpanded, stateKey, isLongCode]);

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
      data-testid="code-block"
      tabIndex={0}
      className={cn(
        "relative group rounded-lg border border-zinc-800 bg-zinc-900",
        "focus:outline-none",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-zinc-800">
        <span className="text-xs text-zinc-400 font-mono">{language}</span>
        <CopyButton code={code} isCopied={isCopied} onCopy={handleCopy} />
      </div>

      {/* Code content */}
      <div
        className={cn(
          "overflow-x-auto p-2 font-mono text-sm",
          !isExpanded && isLongCode && "max-h-[400px] overflow-hidden"
        )}
      >
        <code className="before:content-none after:content-none">
          {isLoading || !tokens ? (
            <pre className="text-zinc-300 whitespace-pre">{code}</pre>
          ) : (
            <HighlightedCode tokens={tokens} />
          )}
        </code>
      </div>

      {/* Expand/Collapse overlay */}
      {isLongCode && (
        <ExpandCollapseOverlay
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
        />
      )}
    </div>
  );
});
