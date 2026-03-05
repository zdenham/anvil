import { create } from 'zustand';
import { scoreMatch } from '@core/skills/index.js';
import type { SkillMetadata, SkillSource } from './types.js';

interface SkillsState {
  skills: Record<string, SkillMetadata>;  // Keyed by slug
  _hydrated: boolean;
  _lastDiscoveryPath: string | null;      // Track which repo we discovered for

  // Selectors
  getBySlug: (slug: string) => SkillMetadata | undefined;
  getAll: () => SkillMetadata[];
  getForSource: (source: SkillSource) => SkillMetadata[];
  search: (query: string) => SkillMetadata[];

  // Mutations
  hydrate: (skills: Record<string, SkillMetadata>, repoPath: string) => void;
  _setHydrated: (hydrated: boolean) => void;
}

// Priority order for sorting
const SOURCE_PRIORITY: Record<SkillSource, number> = {
  project: 0,
  project_command: 1,
  mort: 2,
  personal: 3,
  personal_command: 4,
};

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: {},
  _hydrated: false,
  _lastDiscoveryPath: null,

  getBySlug: (slug) => get().skills[slug.toLowerCase()],

  getAll: () => {
    return Object.values(get().skills)
      .filter(s => s.userInvocable)
      .sort((a, b) =>
        SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] ||
        a.name.localeCompare(b.name)
      );
  },

  getForSource: (source) => {
    return Object.values(get().skills)
      .filter(s => s.source === source && s.userInvocable);
  },

  search: (query) => {
    const q = query.toLowerCase();
    return get().getAll()
      .map(skill => ({ skill, score: scoreMatch(skill, q) }))
      .filter(({ score }) => score < Infinity)
      .sort((a, b) => a.score - b.score)
      .map(({ skill }) => skill);
  },

  hydrate: (skills, repoPath) => set({
    skills,
    _hydrated: true,
    _lastDiscoveryPath: repoPath
  }),

  _setHydrated: (hydrated) => set({ _hydrated: hydrated }),
}));
