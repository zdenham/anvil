import { useMemo } from "react";
import { useRelationStore } from "./store";
import { usePlanStore } from "../plans/store";
import { useThreadStore } from "../threads/store";
import type { PlanMetadata } from "../plans/types";
import type { ThreadMetadata } from "../threads/types";

/**
 * Hook to get plans related to a thread.
 *
 * NOTE: We select _relationsArray directly (not filtered) to avoid creating
 * new array references on every render, which would cause infinite loops.
 * The filtering is done inside useMemo instead.
 */
export function useRelatedPlans(threadId: string): PlanMetadata[] {
  const relationsArray = useRelationStore((state) => state._relationsArray);
  const plans = usePlanStore((state) => state.plans);

  return useMemo(() => {
    return relationsArray
      .filter((r) => r.threadId === threadId && !r.archived)
      .map((r) => plans[r.planId])
      .filter((p): p is PlanMetadata => p !== undefined);
  }, [relationsArray, plans, threadId]);
}

/**
 * Hook to get threads related to a plan.
 */
export function useRelatedThreads(planId: string): ThreadMetadata[] {
  const relationsArray = useRelationStore((state) => state._relationsArray);
  const threads = useThreadStore((state) => state.threads);

  return useMemo(() => {
    return relationsArray
      .filter((r) => r.planId === planId && !r.archived)
      .map((r) => threads[r.threadId])
      .filter((t): t is ThreadMetadata => t !== undefined);
  }, [relationsArray, threads, planId]);
}

/**
 * Hook to get threads related to a plan, including archived.
 * Useful for showing "threads that touched this plan" history.
 */
export function useRelatedThreadsIncludingArchived(planId: string): ThreadMetadata[] {
  const relationsArray = useRelationStore((state) => state._relationsArray);
  const threads = useThreadStore((state) => state.threads);

  return useMemo(() => {
    return relationsArray
      .filter((r) => r.planId === planId)
      .map((r) => threads[r.threadId])
      .filter((t): t is ThreadMetadata => t !== undefined);
  }, [relationsArray, threads, planId]);
}
