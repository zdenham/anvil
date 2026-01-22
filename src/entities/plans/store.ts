import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { PlanMetadata } from "./types";

interface PlanStoreState {
  // All plan metadata (always in memory, lightweight)
  plans: Record<string, PlanMetadata>;

  // Cached array of all plans (to prevent Object.values() infinite loops)
  _plansArray: PlanMetadata[];

  // Hydration flag
  _hydrated: boolean;
}

interface PlanStoreActions {
  /** Hydration (called once at app start) */
  hydrate: (plans: Record<string, PlanMetadata>) => void;

  /** Selectors */
  getAll: () => PlanMetadata[];
  getPlan: (id: string) => PlanMetadata | undefined;
  getByPathPrefix: (pathPrefix: string) => PlanMetadata[];
  getUnreadPlans: () => PlanMetadata[];
  findByPath: (absolutePath: string) => PlanMetadata | undefined;

  /** Read status management */
  markPlanAsRead: (id: string) => void;
  markPlanAsUnread: (id: string) => void;

  /** Optimistic apply methods - return rollback functions for use with optimistic() */
  _applyCreate: (plan: PlanMetadata) => Rollback;
  _applyUpdate: (id: string, updates: Partial<PlanMetadata>) => Rollback;
  _applyDelete: (id: string) => Rollback;
}

export const usePlanStore = create<PlanStoreState & PlanStoreActions>(
  (set, get) => ({
    // ═══════════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════════
    plans: {},
    _plansArray: [],
    _hydrated: false,

    // ═══════════════════════════════════════════════════════════════════════════
    // Hydration
    // ═══════════════════════════════════════════════════════════════════════════
    hydrate: (plans) => {
      const plansArray = Object.values(plans);
      set({
        _hydrated: true,
        plans,
        _plansArray: plansArray,
      });
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Selectors
    // ═══════════════════════════════════════════════════════════════════════════
    getAll: () => get()._plansArray,

    getPlan: (id) => get().plans[id],

    getByPathPrefix: (pathPrefix) =>
      get()._plansArray.filter((p) => p.absolutePath.startsWith(pathPrefix)),

    getUnreadPlans: () => get()._plansArray.filter((p) => !p.isRead),

    findByPath: (absolutePath) =>
      get()._plansArray.find((p) => p.absolutePath === absolutePath),

    // ═══════════════════════════════════════════════════════════════════════════
    // Read Status Management
    // ═══════════════════════════════════════════════════════════════════════════
    markPlanAsRead: (id) => {
      const plan = get().plans[id];
      if (!plan || plan.isRead) return; // Skip if already read

      const updated = { ...plan, isRead: true };
      set((state) => {
        const newPlans = { ...state.plans, [id]: updated };
        return {
          plans: newPlans,
          _plansArray: Object.values(newPlans),
        };
      });
    },

    markPlanAsUnread: (id) => {
      const plan = get().plans[id];
      if (!plan) return;

      const updated = { ...plan, isRead: false };
      set((state) => {
        const newPlans = { ...state.plans, [id]: updated };
        return {
          plans: newPlans,
          _plansArray: Object.values(newPlans),
        };
      });
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Optimistic Apply Methods
    // ═══════════════════════════════════════════════════════════════════════════
    _applyCreate: (plan: PlanMetadata): Rollback => {
      set((state) => {
        const newPlans = { ...state.plans, [plan.id]: plan };
        return {
          plans: newPlans,
          _plansArray: Object.values(newPlans),
        };
      });
      return () =>
        set((state) => {
          const { [plan.id]: _, ...rest } = state.plans;
          return {
            plans: rest,
            _plansArray: Object.values(rest),
          };
        });
    },

    _applyUpdate: (id: string, updates: Partial<PlanMetadata>): Rollback => {
      const previous = get().plans[id];
      if (!previous) return () => {};

      const updated = { ...previous, ...updates };
      set((state) => {
        const newPlans = { ...state.plans, [id]: updated };
        return {
          plans: newPlans,
          _plansArray: Object.values(newPlans),
        };
      });
      return () =>
        set((state) => {
          const restoredPlans = { ...state.plans, [id]: previous };
          return {
            plans: restoredPlans,
            _plansArray: Object.values(restoredPlans),
          };
        });
    },

    _applyDelete: (id: string): Rollback => {
      const previous = get().plans[id];
      if (!previous) return () => {};

      set((state) => {
        const { [id]: _, ...rest } = state.plans;
        return {
          plans: rest,
          _plansArray: Object.values(rest),
        };
      });
      return () =>
        set((state) => {
          const restoredPlans = { ...state.plans, [id]: previous };
          return {
            plans: restoredPlans,
            _plansArray: Object.values(restoredPlans),
          };
        });
    },
  })
);
