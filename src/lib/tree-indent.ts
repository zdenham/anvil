/**
 * Shared indentation constants for all tree views.
 *
 * Formula: paddingLeft = TREE_INDENT_BASE + depth * TREE_INDENT_STEP
 *
 * TREE_INDENT_BASE: left padding for depth-0 items (breathing room from edge).
 * TREE_INDENT_STEP: additional padding per nesting level.
 */
export const TREE_INDENT_BASE = 8; // px
export const TREE_INDENT_STEP = 8; // px per depth level

/** Compute paddingLeft in pixels for a given tree depth. */
export function getTreeIndentPx(depth: number): number {
  return TREE_INDENT_BASE + depth * TREE_INDENT_STEP;
}

/** Compute paddingLeft style for a given tree depth. */
export function getTreeIndentStyle(depth: number): React.CSSProperties {
  return { paddingLeft: getTreeIndentPx(depth) };
}
