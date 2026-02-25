/**
 * PrChecksSection
 *
 * Displays CI check runs in a collapsible card with status icons, names,
 * durations, and links.
 */

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  MinusCircle,
  Ban,
  ExternalLink,
} from "lucide-react";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import type { PullRequestDetails } from "@/entities/pull-requests/types";

interface PrChecksSectionProps {
  checks: PullRequestDetails["checks"];
}

function formatDuration(
  startedAt: string | null,
  completedAt: string | null,
): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function CheckStatusIcon({ status }: { status: string }) {
  if (status === "pass") {
    return <CheckCircle2 size={14} className="text-green-400 shrink-0" />;
  }
  if (status === "fail") {
    return <XCircle size={14} className="text-red-400 shrink-0" />;
  }
  if (status === "pending") {
    return <Loader2 size={14} className="text-amber-400 animate-spin shrink-0" />;
  }
  if (status === "skipping") {
    return <MinusCircle size={14} className="text-surface-500 shrink-0" />;
  }
  // cancelled
  return <Ban size={14} className="text-surface-500 shrink-0" />;
}

export function PrChecksSection({ checks }: PrChecksSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const passCount = checks.filter((c) => c.status === "pass").length;

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      className="bg-surface-800/30 rounded-lg border border-dashed border-surface-700"
      headerClassName="flex items-center gap-2 px-4 py-3"
      header={
        <>
          <ExpandChevron isExpanded={isExpanded} size="sm" />
          <h3 className="text-sm font-medium font-mono text-surface-200">Checks</h3>
          {checks.length > 0 && (
            <span className="text-xs text-surface-400">
              {passCount}/{checks.length} passed
            </span>
          )}
        </>
      }
    >
      <div className="px-4 pb-3">
        {checks.length === 0 ? (
          <p className="text-sm text-surface-500 italic">No CI checks</p>
        ) : (
          <div className="space-y-1.5">
            {checks.map((check) => (
              <CheckRow key={check.name} check={check} />
            ))}
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}

function CheckRow({ check }: { check: PrChecksSectionProps["checks"][number] }) {
  const duration = formatDuration(check.startedAt, check.completedAt);

  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <CheckStatusIcon status={check.status} />
      <span className="text-surface-200 truncate flex-1">{check.name}</span>
      {duration && (
        <span className="text-surface-500 shrink-0">{duration}</span>
      )}
      {check.url && (
        <a
          href={check.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-0.5 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors shrink-0"
          aria-label={`Open ${check.name} in browser`}
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}
