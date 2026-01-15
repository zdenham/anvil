import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { logger } from "@/lib/logger-client";

interface FileCardErrorBoundaryProps {
  /** File path for display in error state */
  filePath: string;
  /** Child components to render */
  children: ReactNode;
  /** Raw diff content for fallback display */
  rawDiff?: string;
}

interface FileCardErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The error that was caught */
  error: Error | null;
  /** Whether to show raw diff */
  showRaw: boolean;
}

/**
 * Error boundary wrapper for DiffFileCard components.
 * Prevents one broken file from crashing the entire diff viewer.
 *
 * Features:
 * - Catches render errors in child components
 * - Shows fallback UI with file path and error message
 * - Provides retry button to attempt re-render
 * - Logs errors for debugging
 */
export class FileCardErrorBoundary extends Component<
  FileCardErrorBoundaryProps,
  FileCardErrorBoundaryState
> {
  constructor(props: FileCardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showRaw: false };
  }

  static getDerivedStateFromError(error: Error): FileCardErrorBoundaryState {
    return { hasError: true, error, showRaw: false };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error(
      `[DiffViewer] Error rendering file: ${this.props.filePath}`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, showRaw: false });
  };

  handleToggleRaw = () => {
    this.setState((prev) => ({ showRaw: !prev.showRaw }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-lg overflow-hidden border border-red-500/30 bg-red-950/10"
          role="region"
          aria-label={`Error displaying ${this.props.filePath}`}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-red-950/30">
            <AlertTriangle
              className="w-4 h-4 text-red-400 flex-shrink-0"
              aria-hidden="true"
            />
            <span className="font-mono text-sm text-surface-200 truncate flex-1">
              {this.props.filePath}
            </span>
            <span className="px-2 py-0.5 text-xs rounded font-medium bg-red-500/20 text-red-400">
              Error
            </span>
          </div>

          {/* Error content */}
          <div className="p-4 space-y-3">
            <p className="text-sm text-surface-400">
              Failed to render this file&apos;s diff.
            </p>

            {this.state.error && (
              <pre className="p-3 text-xs font-mono text-red-300 bg-red-950/30 rounded overflow-x-auto">
                {this.state.error.message}
              </pre>
            )}

            <div className="flex flex-wrap gap-2">
              {this.props.rawDiff && (
                <button
                  onClick={this.handleToggleRaw}
                  className="
                    inline-flex items-center gap-1.5 px-3 py-1.5
                    text-sm text-surface-300
                    hover:text-white hover:bg-surface-700
                    rounded transition-colors
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
                  "
                  aria-expanded={this.state.showRaw}
                  aria-controls="raw-diff-fallback"
                >
                  {this.state.showRaw ? (
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
              <button
                onClick={this.handleRetry}
                className="
                  inline-flex items-center gap-2 px-3 py-1.5
                  text-sm text-surface-300
                  hover:text-white hover:bg-surface-700
                  rounded transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
                "
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Retry
              </button>
            </div>

            {/* Raw diff fallback */}
            {this.state.showRaw && this.props.rawDiff && (
              <pre
                id="raw-diff-fallback"
                className="p-3 text-xs font-mono text-surface-300 bg-surface-900 rounded overflow-auto max-h-96"
              >
                {this.props.rawDiff}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
