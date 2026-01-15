import { useState, useRef, useEffect } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface DiffErrorStateProps {
  /** Error message to display */
  error: string;
  /** Raw diff content to show as fallback */
  rawDiff?: string;
  /** Callback to retry the operation */
  onRetry?: () => void;
}

/**
 * Error state for the diff viewer.
 * Shows error message with option to view raw diff and retry.
 */
export function DiffErrorState({
  error,
  rawDiff,
  onRetry,
}: DiffErrorStateProps) {
  const [showRaw, setShowRaw] = useState(false);
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  // Focus retry button on mount for accessibility
  useEffect(() => {
    retryButtonRef.current?.focus();
  }, []);

  return (
    <div
      className="p-4 border border-red-500/50 rounded-lg bg-red-950/20"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" aria-hidden="true" />
        <p className="text-red-400 font-medium">Failed to parse diff</p>
      </div>

      <p className="text-sm text-surface-400 mb-4">{error}</p>

      <div className="flex flex-wrap gap-2">
        {rawDiff && (
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-surface-400 hover:text-white hover:bg-surface-800 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            aria-expanded={showRaw}
            aria-controls="raw-diff-content"
          >
            {showRaw ? (
              <>
                <ChevronUp className="w-4 h-4" aria-hidden="true" />
                Hide raw diff
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
                Show raw diff
              </>
            )}
          </button>
        )}
        {onRetry && (
          <button
            ref={retryButtonRef}
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-surface-400 hover:text-white hover:bg-surface-800 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Retry
          </button>
        )}
      </div>

      {showRaw && rawDiff && (
        <pre
          id="raw-diff-content"
          className="mt-4 p-3 bg-surface-900 rounded text-xs text-surface-300 overflow-auto max-h-96 font-mono"
        >
          {rawDiff}
        </pre>
      )}
    </div>
  );
}

interface FileErrorStateProps {
  /** File path that failed */
  filePath: string;
  /** Error message */
  error: string;
  /** Raw diff content for this file */
  rawDiff?: string;
  /** Callback to retry */
  onRetry?: () => void;
}

/**
 * Error state for a single file card.
 * Used with error boundaries to handle per-file errors.
 */
export function FileErrorState({
  filePath,
  error,
  rawDiff,
  onRetry,
}: FileErrorStateProps) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div
      className="rounded-lg overflow-hidden border border-red-500/30"
      role="alert"
    >
      {/* File header */}
      <div className="px-4 py-3 bg-surface-800 border-b border-red-500/30">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" aria-hidden="true" />
          <span className="font-mono text-sm text-surface-300 truncate">
            {filePath}
          </span>
          <span className="px-2 py-0.5 text-xs rounded bg-red-500/20 text-red-400">
            Error
          </span>
        </div>
      </div>

      {/* Error content */}
      <div className="p-4 bg-red-950/10">
        <p className="text-sm text-red-400 mb-3">{error}</p>

        <div className="flex flex-wrap gap-2">
          {rawDiff && (
            <button
              type="button"
              onClick={() => setShowRaw(!showRaw)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-surface-400 hover:text-white hover:bg-surface-800 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              aria-expanded={showRaw}
            >
              {showRaw ? "Hide" : "Show"} raw diff
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-surface-400 hover:text-white hover:bg-surface-800 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </button>
          )}
        </div>

        {showRaw && rawDiff && (
          <pre className="mt-3 p-2 bg-surface-900 rounded text-xs text-surface-300 overflow-auto max-h-64 font-mono">
            {rawDiff}
          </pre>
        )}
      </div>
    </div>
  );
}
