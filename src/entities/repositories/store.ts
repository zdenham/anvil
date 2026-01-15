import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { Repository } from "./types";

interface RepositoryState {
  repositories: Record<string, Repository>;
  _hydrated: boolean;
}

interface RepositoryActions {
  /** Hydration (called once at app start) */
  hydrate: (repositories: Record<string, Repository>) => void;

  /** Selectors */
  getRepository: (name: string) => Repository | undefined;
  getRepositoryNames: () => string[];

  /** Optimistic apply methods - return rollback functions for use with optimistic() */
  _applyCreate: (repo: Repository) => Rollback;
  _applyUpdate: (name: string, repo: Repository) => Rollback;
  _applyDelete: (name: string) => Rollback;
}

export const useRepoStore = create<RepositoryState & RepositoryActions>(
  (set, get) => ({
    // ═══════════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════════
    repositories: {},
    _hydrated: false,

    // ═══════════════════════════════════════════════════════════════════════════
    // Hydration
    // ═══════════════════════════════════════════════════════════════════════════
    hydrate: (repositories) => {
      set({ repositories, _hydrated: true });
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Selectors
    // ═══════════════════════════════════════════════════════════════════════════
    getRepository: (name) => get().repositories[name],
    getRepositoryNames: () => Object.keys(get().repositories),

    // ═══════════════════════════════════════════════════════════════════════════
    // Optimistic Apply Methods
    // ═══════════════════════════════════════════════════════════════════════════
    _applyCreate: (repo: Repository): Rollback => {
      set((state) => ({
        repositories: { ...state.repositories, [repo.name]: repo },
      }));
      return () =>
        set((state) => {
          const { [repo.name]: _, ...rest } = state.repositories;
          return { repositories: rest };
        });
    },

    _applyUpdate: (name: string, repo: Repository): Rollback => {
      const prev = get().repositories[name];
      set((state) => ({
        repositories: { ...state.repositories, [name]: repo },
      }));
      return () =>
        set((state) => ({
          repositories: prev
            ? { ...state.repositories, [name]: prev }
            : state.repositories,
        }));
    },

    _applyDelete: (name: string): Rollback => {
      const prev = get().repositories[name];
      set((state) => {
        const { [name]: _, ...rest } = state.repositories;
        return { repositories: rest };
      });
      return () =>
        set((state) => ({
          repositories: prev
            ? { ...state.repositories, [name]: prev }
            : state.repositories,
        }));
    },
  })
);
