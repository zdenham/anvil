interface PermissionsContentProps {
  // Documents/shell initialization
  shellInitialized?: boolean;
  isInitializingShell?: boolean;
  onRequestShellInit?: () => void;
  // Accessibility
  accessibilityGranted: boolean;
  isCheckingAccessibility: boolean;
  onRequestAccessibility: () => void;
  onSkip?: () => void;
}

export const PermissionsContent = ({
  shellInitialized = true, // Default to true for backwards compat (existing callers)
  isInitializingShell = false,
  onRequestShellInit,
  accessibilityGranted,
  isCheckingAccessibility,
  onRequestAccessibility,
  onSkip,
}: PermissionsContentProps) => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-surface-100 font-mono">
        Permissions
      </h2>
      <p className="text-surface-300">
        Mort needs a few permissions to work at full capacity.
      </p>

      <div className="space-y-4">
        {/* Documents Access - FIRST (if handler provided) */}
        {onRequestShellInit && (
          <div className="flex items-center gap-3">
            {shellInitialized ? (
              <>
                <span className="text-green-400 font-mono">✓</span>
                <span className="text-surface-200 font-medium">
                  Documents Access granted
                </span>
              </>
            ) : (
              <>
                <span className="text-surface-400 font-mono">•</span>
                <button
                  onClick={onRequestShellInit}
                  disabled={isInitializingShell}
                  className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  {isInitializingShell ? "Initializing..." : "Grant Documents Access ↗"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Accessibility Access */}
        <div className="flex items-center gap-3">
          {accessibilityGranted ? (
            <>
              <span className="text-green-400 font-mono">✓</span>
              <span className="text-surface-200 font-medium">
                Accessibility Access granted
              </span>
            </>
          ) : (
            <>
              <span className="text-surface-400 font-mono">•</span>
              <button
                onClick={onRequestAccessibility}
                disabled={isCheckingAccessibility}
                className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isCheckingAccessibility ? "Requesting..." : "Grant Accessibility Access ↗"}
              </button>
            </>
          )}
        </div>
      </div>

      {!accessibilityGranted && onSkip && (
        <button
          onClick={onSkip}
          className="text-surface-500 hover:text-surface-300 underline decoration-dotted underline-offset-4 text-sm transition-colors"
        >
          Skip for now
        </button>
      )}
    </div>
  );
};
