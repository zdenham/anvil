import { useCallback, useMemo } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import { cn } from "@/lib/utils";

const DEFAULT_CONTEXT_WINDOW = 200_000;

const USAGE_LEVELS = [
  { max: 0.5, color: "bg-green-500", label: "low" },
  { max: 0.8, color: "bg-yellow-500", label: "medium" },
  { max: 0.95, color: "bg-orange-500", label: "high" },
  { max: Infinity, color: "bg-red-500", label: "critical" },
] as const;


function getUsageColor(ratio: number): string {
  for (const level of USAGE_LEVELS) {
    if (ratio < level.max) return level.color;
  }
  return "bg-red-500";
}


interface ContextMeterProps {
  threadId: string;
}

export function ContextMeter({ threadId }: ContextMeterProps) {
  // Read usage from metadata (always available) instead of state (lazy-loaded)
  const thread = useThreadStore(
    useCallback((s) => s.threads[threadId], [threadId]),
  );
  // Fall back to state for context window size (metrics are only in state)
  const threadState = useThreadStore(
    useCallback((s) => s.threadStates[threadId], [threadId]),
  );

  // Subscribe to entire threads map so we re-render when any descendant's usage changes
  const allThreads = useThreadStore(useCallback((s) => s.threads, []));
  const aggregateUsage = useMemo(() => {
    return threadService.getAggregateUsage(threadId);
  }, [allThreads, threadId]);

  const hasDescendants = !!(aggregateUsage && thread?.cumulativeUsage &&
    (aggregateUsage.inputTokens !== thread.cumulativeUsage.inputTokens ||
     aggregateUsage.outputTokens !== thread.cumulativeUsage.outputTokens));

  const usage = thread?.lastCallUsage;
  if (!usage) return null;

  const contextWindow =
    threadState?.metrics?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const totalInputTokens =
    usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  const ratio = Math.min(totalInputTokens / contextWindow, 1);
  const percentage = (ratio * 100).toFixed(1);
  const color = getUsageColor(ratio);

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <div className="flex items-center gap-1.5 cursor-default">
            <div className="w-16 h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  color,
                  "h-full rounded-full transition-all duration-300 ease-out",
                )}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-surface-400 tabular-nums">
              {percentage}%
            </span>
          </div>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="bottom"
            sideOffset={8}
            className={cn(
              "z-50 px-3 py-2 text-xs font-mono",
              "bg-surface-800 text-surface-200 border border-surface-700",
              "rounded shadow-md",
              "animate-in fade-in-0 zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            )}
          >
            <TooltipContent
              usage={usage}
              cumulativeUsage={thread?.cumulativeUsage}
              aggregateUsage={aggregateUsage}
              hasDescendants={hasDescendants}
              contextWindow={contextWindow}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

interface TokenUsageFields {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface TooltipContentProps {
  usage: TokenUsageFields;
  cumulativeUsage?: TokenUsageFields;
  aggregateUsage?: TokenUsageFields;
  hasDescendants: boolean;
  contextWindow: number;
}

// Hardcoded for Opus 4.6 — update if we support model selection
const PRICE_INPUT = 5 / 1_000_000;
const PRICE_CACHE_WRITE = 6.25 / 1_000_000;
const PRICE_CACHE_READ = 0.5 / 1_000_000;
const PRICE_OUTPUT = 25 / 1_000_000;

function calculateCost(usage: TokenUsageFields): number {
  return (
    usage.inputTokens * PRICE_INPUT +
    usage.cacheCreationTokens * PRICE_CACHE_WRITE +
    usage.cacheReadTokens * PRICE_CACHE_READ +
    usage.outputTokens * PRICE_OUTPUT
  );
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokensK(n: number): string {
  return `${(n / 1000).toFixed(0)}k`;
}

function TooltipContent({
  usage,
  cumulativeUsage,
  aggregateUsage,
  hasDescendants,
  contextWindow,
}: TooltipContentProps) {
  const contextTotal =
    usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;

  return (
    <div className="text-[10px] font-mono tabular-nums">
      <div className="flex justify-between gap-4">
        <span className="text-surface-400">context</span>
        <span className="text-surface-300">
          {formatTokensK(contextTotal)} / {formatTokensK(contextWindow)}
        </span>
      </div>
      {cumulativeUsage && (
        <div className="flex justify-between gap-4 mt-0.5">
          <span className="text-surface-400">
            {hasDescendants ? "own cost" : "thread cost"}
          </span>
          <span className="text-surface-300">
            {formatCost(calculateCost(cumulativeUsage))}
          </span>
        </div>
      )}
      {aggregateUsage && hasDescendants && (
        <div className="flex justify-between gap-4 mt-0.5">
          <span className="text-surface-400">total cost</span>
          <span className="text-surface-300">
            {formatCost(calculateCost(aggregateUsage))}
          </span>
        </div>
      )}
    </div>
  );
}
