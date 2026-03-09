/**
 * PrMergeSection
 *
 * Merge button with method dropdown for open, non-draft PRs.
 * Respects repo-level allowed merge methods.
 */

import { useCallback, useEffect, useState } from "react";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { pullRequestService } from "@/entities/pull-requests/service";
import { logger } from "@/lib/logger-client";
import type { MergeMethod } from "@/lib/gh-cli";
import type { PullRequestDetails } from "@/entities/pull-requests/types";

interface PrMergeSectionProps {
  prId: string;
  repoSlug: string;
  state: PullRequestDetails["state"];
  isDraft: boolean;
}

const METHOD_LABELS: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

export function PrMergeSection({ prId, repoSlug, state, isDraft }: PrMergeSectionProps) {
  const mergeSettings = usePullRequestStore(
    useCallback((s) => s.repoMergeSettings[repoSlug], [repoSlug]),
  );
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state !== "OPEN" || isDraft) return null;

  // Fetch allowed methods on mount
  useEffect(() => {
    pullRequestService.fetchMergeSettings(prId);
  }, [prId]);

  // Set default method once settings load
  useEffect(() => {
    if (mergeSettings && !method) {
      setMethod(mergeSettings.defaultMethod);
    }
  }, [mergeSettings, method]);

  const selectedMethod = method ?? mergeSettings?.defaultMethod ?? "squash";
  const allowedMethods = mergeSettings?.allowedMethods ?? [];

  const handleMerge = async () => {
    setIsMerging(true);
    setError(null);
    try {
      await pullRequestService.merge(prId, selectedMethod);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[PrMergeSection] Merge failed", { error: message });
      setError(message);
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="bg-surface-800/30 rounded-lg border border-dashed border-surface-700 px-4 py-3">
      <div className="flex items-center gap-3">
        {allowedMethods.length > 1 && (
          <select
            value={selectedMethod}
            onChange={(e) => setMethod(e.target.value as MergeMethod)}
            disabled={isMerging}
            className="bg-surface-700 text-surface-200 text-sm rounded px-2 py-1.5 border border-surface-600 focus:outline-none focus:border-surface-400"
          >
            {allowedMethods.map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </select>
        )}
        {allowedMethods.length === 1 && (
          <span className="text-sm text-surface-300">{METHOD_LABELS[allowedMethods[0]]}</span>
        )}

        <button
          onClick={handleMerge}
          disabled={isMerging || !mergeSettings}
          className="ml-auto px-4 py-1.5 text-sm font-medium rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isMerging ? "Merging..." : "Merge"}
        </button>
      </div>
      {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
    </div>
  );
}
