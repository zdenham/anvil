import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { PlanThreadRelation } from "@core/types/relations.js";

interface RelationStoreState {
  // All relations (key: `${planId}-${threadId}`)
  relations: Record<string, PlanThreadRelation>;

  // Cached array (prevents Object.values() infinite loops in React)
  _relationsArray: PlanThreadRelation[];

  // Hydration flag
  _hydrated: boolean;
}

interface RelationStoreActions {
  /** Hydration (called once at app start) */
  hydrate: (relations: Record<string, PlanThreadRelation>) => void;

  /** Selectors */
  getAll: () => PlanThreadRelation[];
  get: (planId: string, threadId: string) => PlanThreadRelation | undefined;
  getByPlan: (planId: string) => PlanThreadRelation[];
  getByThread: (threadId: string) => PlanThreadRelation[];
  getByPlanIncludingArchived: (planId: string) => PlanThreadRelation[];
  getByThreadIncludingArchived: (threadId: string) => PlanThreadRelation[];

  /** Optimistic apply methods - return rollback functions */
  _applyCreate: (relation: PlanThreadRelation) => Rollback;
  _applyUpdate: (planId: string, threadId: string, updates: Partial<PlanThreadRelation>) => Rollback;
  _applyDelete: (planId: string, threadId: string) => Rollback;
}

function makeKey(planId: string, threadId: string): string {
  return `${planId}-${threadId}`;
}

export const useRelationStore = create<RelationStoreState & RelationStoreActions>(
  (set, get) => ({
    // State
    relations: {},
    _relationsArray: [],
    _hydrated: false,

    // Hydration
    hydrate: (relations) => {
      set({
        _hydrated: true,
        relations,
        _relationsArray: Object.values(relations),
      });
    },

    // Selectors
    getAll: () => get()._relationsArray.filter(r => !r.archived),

    get: (planId, threadId) => {
      const key = makeKey(planId, threadId);
      return get().relations[key];
    },

    getByPlan: (planId) =>
      get()._relationsArray.filter(r => r.planId === planId && !r.archived),

    getByThread: (threadId) =>
      get()._relationsArray.filter(r => r.threadId === threadId && !r.archived),

    getByPlanIncludingArchived: (planId) =>
      get()._relationsArray.filter(r => r.planId === planId),

    getByThreadIncludingArchived: (threadId) =>
      get()._relationsArray.filter(r => r.threadId === threadId),

    // Optimistic apply methods
    _applyCreate: (relation) => {
      const key = makeKey(relation.planId, relation.threadId);
      set((state) => {
        const newRelations = { ...state.relations, [key]: relation };
        return {
          relations: newRelations,
          _relationsArray: Object.values(newRelations),
        };
      });
      return () =>
        set((state) => {
          const { [key]: _, ...rest } = state.relations;
          return {
            relations: rest,
            _relationsArray: Object.values(rest),
          };
        });
    },

    _applyUpdate: (planId, threadId, updates) => {
      const key = makeKey(planId, threadId);
      const previous = get().relations[key];
      if (!previous) return () => {};

      const updated = { ...previous, ...updates };
      set((state) => {
        const newRelations = { ...state.relations, [key]: updated };
        return {
          relations: newRelations,
          _relationsArray: Object.values(newRelations),
        };
      });
      return () =>
        set((state) => {
          const restoredRelations = { ...state.relations, [key]: previous };
          return {
            relations: restoredRelations,
            _relationsArray: Object.values(restoredRelations),
          };
        });
    },

    _applyDelete: (planId, threadId) => {
      const key = makeKey(planId, threadId);
      const previous = get().relations[key];
      if (!previous) return () => {};

      set((state) => {
        const { [key]: _, ...rest } = state.relations;
        return {
          relations: rest,
          _relationsArray: Object.values(rest),
        };
      });
      return () =>
        set((state) => {
          const restoredRelations = { ...state.relations, [key]: previous };
          return {
            relations: restoredRelations,
            _relationsArray: Object.values(restoredRelations),
          };
        });
    },
  })
);
