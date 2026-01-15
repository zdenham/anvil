import { useRef, useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/reusable/Button";

interface ErrorStateProps {
  /** Error message to display */
  error?: string;
  /** Callback to retry loading */
  onRetry?: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const retryRef = useRef<HTMLButtonElement>(null);

  // Focus retry button on mount for accessibility
  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  return (
    <div
      data-testid="error-message"
      className="flex flex-col items-center justify-center flex-1 gap-4 p-6"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2 text-destructive">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
        <h2 className="text-lg font-medium">Something went wrong</h2>
      </div>

      {error && (
        <p className="text-sm text-muted-foreground max-w-md text-center">
          {error}
        </p>
      )}

      {onRetry && (
        <Button
          ref={retryRef}
          onClick={onRetry}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
