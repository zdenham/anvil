import { generateKeyBetween } from "fractional-indexing";
import { logger } from "@/lib/logger-client";
import type { TreeItemNode } from "@/stores/tree-menu/types";

/**
 * Generate a sort key between two adjacent items.
 * @param before - sortKey of the item before the insertion point, or null for start
 * @param after - sortKey of the item after the insertion point, or null for end
 * @returns A string key that sorts between `before` and `after`
 */
export function generateSortKey(
  before: string | null,
  after: string | null,
): string {
  return generateKeyBetween(before, after);
}

/**
 * Given the siblings of the target parent and an insertion index,
 * compute the sortKey for the dropped item.
 *
 * @param siblings - The current children of the target parent, sorted in display order
 * @param insertionIndex - Where in the sibling list the item is being inserted (0-based)
 * @returns The new sortKey string
 */
export function computeSortKeyForInsertion(
  siblings: TreeItemNode[],
  insertionIndex: number,
): string {
  const before = insertionIndex > 0
    ? siblings[insertionIndex - 1].sortKey ?? null
    : null;
  const after = insertionIndex < siblings.length
    ? siblings[insertionIndex].sortKey ?? null
    : null;
  const result = generateKeyBetween(before, after);
  logger.debug("[dnd:sortKey] computeSortKeyForInsertion", {
    siblingCount: siblings.length,
    insertionIndex,
    beforeKey: before,
    afterKey: after,
    generatedKey: result,
  });
  return result;
}
