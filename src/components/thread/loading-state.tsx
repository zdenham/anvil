import { Loader2 } from "lucide-react";

export function LoadingState() {
  return (
    <div
      data-testid="loading-spinner"
      className="flex flex-col items-center justify-center flex-1 gap-3 text-surface-400"
      role="status"
      aria-label="Loading thread"
    >
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      <p className="text-sm">Loading thread...</p>
    </div>
  );
}
