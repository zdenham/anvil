/**
 * Store seeding helpers for UI isolation tests.
 *
 * Provides utilities to seed Zustand stores with test data,
 * ensuring test isolation and predictable initial state.
 */

import { useThreadStore } from "@/entities/threads/store";
import { useRepoStore } from "@/entities/repositories/store";
import { useSettingsStore } from "@/entities/settings/store";
import { useLogStore } from "@/entities/logs/store";
import { usePlanStore } from "@/entities/plans/store";
import { useRelationStore } from "@/entities/relations/store";
import { DEFAULT_WORKSPACE_SETTINGS } from "@/entities/settings/types";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { Repository } from "@/entities/repositories/types";
import type { ThreadState } from "@/lib/types/agent-messages";
import type { PlanMetadata } from "@/entities/plans/types";
import type { PlanThreadRelation } from "@core/types/relations.js";

// ============================================================================
// Store State Types (for seeding)
// ============================================================================

interface ThreadStoreState {
  threads?: Record<string, ThreadMetadata>;
  activeThreadId?: string | null;
  threadStates?: Record<string, ThreadState>;
  activeThreadLoading?: boolean;
  threadErrors?: Record<string, string>;
}

interface RepoStoreState {
  repositories?: Record<string, Repository>;
}

// ============================================================================
// TestStores Class
// ============================================================================

export class TestStores {
  /**
   * Clear all stores to empty state.
   * Call this in beforeEach to ensure test isolation.
   * Sets _hydrated: false on all stores.
   */
  static clear(): void {
    useThreadStore.setState({
      threads: {},
      _threadsArray: [],
      activeThreadId: null,
      threadStates: {},
      activeThreadLoading: false,
      threadErrors: {},
      _hydrated: false,
    });

    useRepoStore.setState({
      repositories: {},
      _hydrated: false,
    });

    useSettingsStore.setState({
      workspace: DEFAULT_WORKSPACE_SETTINGS,
      _hydrated: false,
    });

    useLogStore.setState({
      logs: [],
      _hydrated: false,
    });

    usePlanStore.setState({
      plans: {},
      _plansArray: [],
      _hydrated: false,
    });

    useRelationStore.setState({
      relations: {},
      _relationsArray: [],
      _hydrated: false,
    });
  }

  // ==========================================================================
  // Thread Store Methods
  // ==========================================================================

  static seedThreads(state: ThreadStoreState): void {
    const threads = state.threads ?? {};
    useThreadStore.setState({
      threads,
      _threadsArray: Object.values(threads),
      activeThreadId: state.activeThreadId ?? null,
      threadStates: state.threadStates ?? {},
      activeThreadLoading: state.activeThreadLoading ?? false,
      threadErrors: state.threadErrors ?? {},
      _hydrated: true,
    });
  }

  static seedThread(thread: ThreadMetadata): void {
    useThreadStore.setState((state) => {
      const newThreads = { ...state.threads, [thread.id]: thread };
      return {
        threads: newThreads,
        _threadsArray: Object.values(newThreads),
        _hydrated: true,
      };
    });
  }

  static seedThreadState(threadId: string, state: ThreadState): void {
    useThreadStore.setState((prev) => ({
      threadStates: { ...prev.threadStates, [threadId]: state },
    }));
  }

  static setActiveThread(threadId: string | null): void {
    useThreadStore.setState({ activeThreadId: threadId });
  }

  // ==========================================================================
  // Repository Store Methods
  // ==========================================================================

  static seedRepositories(state: RepoStoreState): void {
    useRepoStore.setState({
      repositories: state.repositories ?? {},
      _hydrated: true,
    });
  }

  static seedRepository(repo: Repository): void {
    useRepoStore.setState((state) => ({
      repositories: { ...state.repositories, [repo.name]: repo },
      _hydrated: true,
    }));
  }

  // ==========================================================================
  // Settings Store Methods
  // ==========================================================================

  static seedSettings(
    settings: Partial<typeof DEFAULT_WORKSPACE_SETTINGS>
  ): void {
    useSettingsStore.setState({
      workspace: { ...DEFAULT_WORKSPACE_SETTINGS, ...settings },
      _hydrated: true,
    });
  }

  // ==========================================================================
  // Plan Store Methods
  // ==========================================================================

  static seedPlans(plans: PlanMetadata[]): void {
    const planMap = Object.fromEntries(plans.map((p) => [p.id, p]));
    usePlanStore.setState({
      plans: planMap,
      _plansArray: plans,
      _hydrated: true,
    });
  }

  static seedPlan(plan: PlanMetadata): void {
    usePlanStore.setState((state) => {
      const newPlans = { ...state.plans, [plan.id]: plan };
      return {
        plans: newPlans,
        _plansArray: Object.values(newPlans),
        _hydrated: true,
      };
    });
  }

  // ==========================================================================
  // Relation Store Methods
  // ==========================================================================

  static seedRelations(relations: PlanThreadRelation[]): void {
    const relationMap = Object.fromEntries(
      relations.map((r) => [`${r.planId}-${r.threadId}`, r])
    );
    useRelationStore.setState({
      relations: relationMap,
      _relationsArray: relations,
      _hydrated: true,
    });
  }

  static seedRelation(relation: PlanThreadRelation): void {
    useRelationStore.setState((state) => {
      const key = `${relation.planId}-${relation.threadId}`;
      const newRelations = { ...state.relations, [key]: relation };
      return {
        relations: newRelations,
        _relationsArray: Object.values(newRelations),
        _hydrated: true,
      };
    });
  }

  // ==========================================================================
  // Getter Methods (for assertions)
  // ==========================================================================

  static getThreadState() {
    return useThreadStore.getState();
  }

  static getRepoState() {
    return useRepoStore.getState();
  }

  static getSettingsState() {
    return useSettingsStore.getState();
  }

  static getLogsState() {
    return useLogStore.getState();
  }

  static getPlanState() {
    return usePlanStore.getState();
  }

  static getRelationState() {
    return useRelationStore.getState();
  }
}
