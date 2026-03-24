import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { logger } from "../logger.js";

export interface BudgetCheckResult {
  overBudget: boolean;
  budgetThreadId?: string;
  capUsd?: number;
  spentUsd?: number;
}

/**
 * Walk up the ancestor chain from threadId. If any ancestor has budgetCapUsd,
 * check if its total spend (own + descendants) exceeds the cap.
 * Nearest budget root wins -- stop at first cap found.
 */
export function isOverBudget(
  threadId: string,
  anvilDir: string,
): BudgetCheckResult {
  const visited = new Set<string>();
  let currentId: string | undefined = threadId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const metadataPath = join(anvilDir, "threads", currentId, "metadata.json");

    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    } catch {
      break; // Missing or corrupt metadata -- stop walking
    }

    const capUsd = metadata.budgetCapUsd as number | undefined;
    if (capUsd !== undefined && capUsd > 0) {
      const ownCost = (metadata.totalCostUsd as number) ?? 0;
      const childrenCost = (metadata.cumulativeCostUsd as number) ?? 0;
      const spentUsd = ownCost + childrenCost;

      if (spentUsd >= capUsd) {
        return {
          overBudget: true,
          budgetThreadId: currentId,
          capUsd,
          spentUsd,
        };
      }
      // Found a budget cap that's not exceeded -- stop here
      return {
        overBudget: false,
        budgetThreadId: currentId,
        capUsd,
        spentUsd,
      };
    }

    currentId = metadata.parentThreadId as string | undefined;
  }

  return { overBudget: false };
}

/**
 * Add a child's tree cost to the parent's cumulativeCostUsd in metadata.json.
 * childTreeCost should be the child's totalCostUsd + cumulativeCostUsd.
 *
 * Uses sync write -- this is called from waitForResult() and SDK completion,
 * both synchronous contexts.
 */
export function rollUpCostToParent(
  anvilDir: string,
  parentThreadId: string,
  childTreeCost: number,
): void {
  if (childTreeCost <= 0) return;

  const parentPath = join(
    anvilDir,
    "threads",
    parentThreadId,
    "metadata.json",
  );
  try {
    const raw = readFileSync(parentPath, "utf-8");
    const parentMeta = JSON.parse(raw);
    parentMeta.cumulativeCostUsd =
      (parentMeta.cumulativeCostUsd ?? 0) + childTreeCost;
    parentMeta.updatedAt = Date.now();
    writeFileSync(parentPath, JSON.stringify(parentMeta, null, 2));
  } catch (err) {
    logger.warn(
      `[budget] Failed to roll up cost to parent ${parentThreadId}: ${err}`,
    );
  }
}
