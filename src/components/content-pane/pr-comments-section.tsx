/**
 * PrCommentsSection
 *
 * Displays inline review comments in a collapsible section.
 * Individual comments are shown inline (not individually collapsible).
 */

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import type { PullRequestDetails } from "@/entities/pull-requests/types";

interface PrCommentsSectionProps {
  comments: PullRequestDetails["reviewComments"];
}

export function PrCommentsSection({ comments }: PrCommentsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const unresolvedCount = comments.filter((c) => !c.isResolved).length;

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      className="bg-surface-800/30 rounded-lg border border-dashed border-surface-700"
      headerClassName="flex items-center gap-2 px-4 py-3"
      header={
        <>
          <ExpandChevron isExpanded={isExpanded} size="sm" />
          <h3 className="text-sm font-medium font-mono text-surface-200">Comments</h3>
          {unresolvedCount > 0 && (
            <span className="text-xs text-surface-400">
              ({unresolvedCount} unresolved)
            </span>
          )}
        </>
      }
    >
      <div className="px-4 pb-3">
        {comments.length === 0 ? (
          <p className="text-sm text-surface-500 italic">No review comments</p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <CommentRow key={comment.id} comment={comment} />
            ))}
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}

function CommentRow({
  comment,
}: {
  comment: PrCommentsSectionProps["comments"][number];
}) {
  const fileLine = comment.line
    ? `${comment.path}:${comment.line}`
    : comment.path;

  return (
    <div
      className={
        comment.isResolved
          ? "border-l-2 border-surface-700 pl-3"
          : "border-l-2 border-amber-500/50 pl-3"
      }
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-surface-300 font-medium">@{comment.author}</span>
        <span className="text-surface-500 truncate">{fileLine}</span>
        {comment.isResolved && (
          <span className="ml-auto flex items-center gap-1 text-surface-500 shrink-0">
            <CheckCircle2 size={10} />
            Resolved
          </span>
        )}
      </div>
      {comment.body && (
        <p className="mt-1 text-xs text-surface-400 whitespace-pre-wrap leading-relaxed">
          {comment.body}
        </p>
      )}
    </div>
  );
}
