/**
 * Loading skeleton for the diff viewer.
 * Displays shimmer placeholders while diff is parsing or highlighter is loading.
 */
export function DiffViewerSkeleton() {
  return (
    <div
      className="space-y-4 p-4"
      role="status"
      aria-label="Loading diff viewer"
    >
      {/* Header skeleton */}
      <div className="h-10 bg-surface-800 rounded animate-pulse" />

      {/* File card skeletons */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg overflow-hidden">
            {/* File header skeleton */}
            <div className="h-12 bg-surface-800 animate-pulse" />
            {/* Content skeleton */}
            <div className="space-y-1 p-2 bg-surface-900/50">
              {[1, 2, 3, 4, 5].map((j) => (
                <div
                  key={j}
                  className="h-6 bg-surface-800/50 rounded animate-pulse"
                  style={{ width: `${60 + Math.random() * 35}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Screen reader text */}
      <span className="sr-only">Loading diff viewer, please wait...</span>
    </div>
  );
}

/**
 * Single file card skeleton for inline loading states.
 */
export function DiffFileCardSkeleton() {
  return (
    <div
      className="rounded-lg overflow-hidden"
      role="status"
      aria-label="Loading file"
    >
      {/* File header skeleton */}
      <div className="h-12 bg-surface-800 animate-pulse flex items-center px-4 gap-3">
        <div className="h-4 w-4 bg-surface-700 rounded animate-pulse" />
        <div className="h-4 bg-surface-700 rounded animate-pulse flex-1 max-w-xs" />
        <div className="h-5 w-16 bg-surface-700 rounded animate-pulse" />
      </div>
      {/* Content skeleton */}
      <div className="space-y-1 p-2 bg-surface-900/50">
        {[1, 2, 3, 4].map((j) => (
          <div key={j} className="flex gap-2">
            <div className="h-6 w-8 bg-surface-800/50 rounded animate-pulse" />
            <div className="h-6 w-8 bg-surface-800/50 rounded animate-pulse" />
            <div
              className="h-6 bg-surface-800/50 rounded animate-pulse flex-1"
              style={{ width: `${40 + Math.random() * 50}%` }}
            />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading file content...</span>
    </div>
  );
}
