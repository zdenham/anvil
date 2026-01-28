/**
 * SuggestedActionsPanel
 *
 * Reusable quick actions panel for content panes.
 * Reads from useQuickActionsStore (read-only) and calls service methods for mutations.
 * Receives keyboard navigation handlers via props.
 *
 * This is a re-export/wrapper of the control-panel version for use in the new content-pane system.
 * In a future phase, this could become the canonical implementation.
 */

// Re-export from control-panel for now
// The existing implementation already follows the patterns we need
export {
  SuggestedActionsPanel,
  type SuggestedActionsPanelRef,
} from "@/components/control-panel/suggested-actions-panel";
