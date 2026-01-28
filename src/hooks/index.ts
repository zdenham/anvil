// UI utilities
export { useReducedMotion } from "./use-reduced-motion";
export { useRelativeTime } from "./use-relative-time";

// Syntax highlighting
export { useCodeHighlight } from "./use-code-highlight";
export type { UseCodeHighlightResult } from "./use-code-highlight";

// Code block keyboard navigation
export { useCodeBlockKeyboard } from "./use-code-block-keyboard";

// Diff viewer utilities
export { useFileContents } from "./use-file-contents";
export type { UseFileContentsResult } from "./use-file-contents";

// Workspace utilities
export { useActionState } from "./use-action-state";
export type { ActionState } from "./use-action-state";

// Thread utilities
export { useMarkThreadAsRead } from "./use-mark-thread-as-read";

// Git utilities
export { useGitCommits } from "./use-git-commits";
export type { GitCommit } from "./use-git-commits";

// Plan utilities
export { usePlanContent } from "./use-plan-content";

// Repository utilities
export { useRepoNames } from "./use-repo-names";
export type { RepoNameMap } from "./use-repo-names";

// Window drag utilities
export { useWindowDrag } from "./use-window-drag";
export type { UseWindowDragOptions, UseWindowDragResult } from "./use-window-drag";

// Fullscreen detection
export { useFullscreen } from "./use-fullscreen";

// Inbox navigation utilities
export { useUnifiedInboxNavigation } from "./use-unified-inbox-navigation";
export type { NavigationResult, UseUnifiedInboxNavigationReturn } from "./use-unified-inbox-navigation";
export { useNavigateToNextItem } from "./use-navigate-to-next-item";
export type { NavigationActionType, UseNavigateToNextItemReturn } from "./use-navigate-to-next-item";
export { useContextAwareNavigation } from "./use-context-aware-navigation";

// Tree data utilities
export {
  useTreeData,
  useTreeSections,
  useSelectedTreeItem,
  useSectionItems,
  useExpandedSections,
  buildTreeFromEntities,
} from "./use-tree-data";
