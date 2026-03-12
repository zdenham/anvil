import { ChevronRight } from "lucide-react";

interface BreadcrumbProps {
  repoName?: string;
  worktreeName?: string;
  category: "threads" | "plans" | "files" | "pull-requests" | "changes";
  itemLabel: string;
  onCategoryClick: () => void;
}

/**
 * Responsive breadcrumb component for content pane headers.
 * Shows full hierarchy (repo > worktree > category > name) at wider widths,
 * falls back to just (category > name) at narrow widths.
 *
 * Uses CSS container queries - parent must have @container class.
 */
export function Breadcrumb({
  repoName,
  worktreeName,
  category,
  itemLabel,
  onCategoryClick,
}: BreadcrumbProps) {
  const showWorktree = !!worktreeName;

  return (
    <div data-testid="breadcrumb" className="flex items-center gap-1.5 text-xs min-w-0">
      {/* Extended context - hidden at narrow widths */}
      {repoName && (
        <div className="hidden @[400px]:flex items-center gap-1.5">
          <span className="text-surface-500 truncate max-w-[120px]">
            {repoName}
          </span>
          <ChevronRight size={12} className="text-surface-600 shrink-0" />
          {showWorktree && (
            <>
              <span className="text-surface-500 truncate max-w-[100px]">
                {worktreeName}
              </span>
              <ChevronRight size={12} className="text-surface-600 shrink-0" />
            </>
          )}
        </div>
      )}

      {/* Always visible: category > name */}
      <button
        onClick={onCategoryClick}
        className="text-surface-400 hover:text-surface-200 focus:outline-none focus:text-surface-200 transition-colors"
      >
        {category}
      </button>
      <ChevronRight size={12} className="text-surface-500 shrink-0" />
      <span className="text-surface-300 truncate max-w-[200px]">
        {itemLabel}
      </span>
    </div>
  );
}
