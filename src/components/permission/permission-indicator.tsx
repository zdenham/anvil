import { useMemo } from "react";
import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissionStore } from "@/entities/permissions/store";
import { usePermissionKeyboard } from "./use-permission-keyboard";
import { isDangerousTool } from "@core/types/permissions.js";

interface PermissionIndicatorProps {
  threadId: string;
}

/**
 * Minimal permission status indicator displayed below the input.
 * Shows a color-coded bar when permissions are pending, not interactive buttons.
 */
export function PermissionIndicator({ threadId }: PermissionIndicatorProps) {
  const allRequests = usePermissionStore((state) => state.requests);

  // Get pending requests for this thread
  const pendingRequests = useMemo(
    () =>
      Object.values(allRequests)
        .filter((r) => r.threadId === threadId && r.status === "pending")
        .sort((a, b) => a.timestamp - b.timestamp),
    [allRequests, threadId]
  );

  // Enable keyboard handling when there are pending requests
  usePermissionKeyboard({
    threadId,
    enabled: pendingRequests.length > 0,
  });

  if (pendingRequests.length === 0) return null;

  const firstRequest = pendingRequests[0];
  const isDangerous = isDangerousTool(firstRequest.toolName);
  const hasMultiple = pendingRequests.length > 1;

  return (
    <div
      className={cn(
        "px-4 py-2 border-t-2 bg-surface-800/50 transition-colors",
        isDangerous
          ? "border-amber-500 bg-amber-950/10"
          : "border-blue-500 bg-blue-950/10"
      )}
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Shield className={cn(
            "h-3 w-3",
            isDangerous ? "text-amber-400" : "text-blue-400"
          )} />
          <span className="text-surface-300">
            Permission required for{" "}
            <span className="font-mono text-surface-200">{firstRequest.toolName}</span>
            {hasMultiple && (
              <span className="ml-1 text-surface-400">
                (+{pendingRequests.length - 1} more)
              </span>
            )}
          </span>
          {isDangerous && (
            <span className="text-amber-400 bg-amber-500/20 px-1 py-0.5 rounded text-xs">
              Writes
            </span>
          )}
        </div>
        <div className="text-surface-400">
          <kbd className="text-xs">y</kbd>/
          <kbd className="text-xs">n</kbd> to respond
        </div>
      </div>
    </div>
  );
}
