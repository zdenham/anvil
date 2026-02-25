/**
 * PrAutoAddressToggle
 *
 * Toggle for enabling/disabling automatic agent spawning to address
 * review comments and CI failures for a PR.
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { ensureGatewayChannelByRepoId } from "@/entities/gateway-channels";
import { pullRequestService } from "@/entities/pull-requests/service";
import { logger } from "@/lib/logger-client";

interface PrAutoAddressToggleProps {
  prId: string;
  autoAddressEnabled: boolean;
  repoId: string;
}

export function PrAutoAddressToggle({
  prId,
  autoAddressEnabled,
  repoId,
}: PrAutoAddressToggleProps) {
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback(async () => {
    if (isToggling) return;
    setIsToggling(true);
    setError(null);

    try {
      if (autoAddressEnabled) {
        await pullRequestService.disableAutoAddress(prId);
        return;
      }

      // Ensure channel exists, is active, and has a live connection.
      // Idempotent — no-op if everything is already set up.
      const channel = await ensureGatewayChannelByRepoId(repoId);
      if (!channel) {
        logger.error(`[PrAutoAddressToggle] Could not ensure gateway channel for repo ${repoId}`);
        setError("Could not connect to gateway — check your connection and try again");
        return;
      }

      await pullRequestService.enableAutoAddress(prId, channel.id);
    } catch (err) {
      logger.error("[PrAutoAddressToggle] Toggle failed:", err);
      setError("Could not connect to gateway — check your connection and try again");
    } finally {
      setIsToggling(false);
    }
  }, [prId, repoId, autoAddressEnabled, isToggling]);

  return (
    <div className="border-t border-surface-700 px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-sm text-surface-200">
          Auto-address comments &amp; CI failures
        </div>
        <div className="text-xs text-surface-400 mt-0.5">
          Automatically spawn agents to address review feedback and fix CI failures
        </div>
        {error && (
          <div className="text-xs text-red-400 mt-1">{error}</div>
        )}
      </div>
      <button
        role="switch"
        aria-checked={autoAddressEnabled}
        disabled={isToggling}
        onClick={handleToggle}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-3",
          autoAddressEnabled ? "bg-secondary-500" : "bg-surface-600",
          isToggling && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
            autoAddressEnabled ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
