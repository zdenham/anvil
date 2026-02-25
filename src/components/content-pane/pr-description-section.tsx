/**
 * PrDescriptionSection
 *
 * Renders the PR body in a collapsible card. Uses MarkdownRenderer when
 * content is available, shows a muted placeholder when the body is empty.
 */

import { MarkdownRenderer } from "@/components/thread/markdown-renderer";

interface PrDescriptionSectionProps {
  body: string;
}

export function PrDescriptionSection({ body }: PrDescriptionSectionProps) {
  return (
    <div className="bg-surface-800/30 rounded-lg border border-dashed border-surface-700 px-4 py-3">
      {body.trim() ? (
        <div className="text-sm">
          <MarkdownRenderer content={body} />
        </div>
      ) : (
        <p className="text-sm text-surface-500 italic">
          No description provided.
        </p>
      )}
    </div>
  );
}
