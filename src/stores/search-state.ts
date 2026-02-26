/**
 * Search State Store
 *
 * Shared zustand store for global→local search handoff.
 * When the user clicks a search result in the global search panel,
 * this store is activated so the content pane can open its FindBar
 * with the query and scroll to the target match.
 *
 * Not used for Cmd+F (local search) — that goes directly through
 * the content pane's own FindBar/hook.
 */

import { create } from "zustand";

interface SearchState {
  /** Whether local content search is activated (by global search) */
  isEnabled: boolean;
  /** The active search query */
  searchQuery: string;
  /** Target match index within the content (0-based, from global search click) */
  targetMatchIndex: number | null;
  /** Backend snippet for heuristic match resolution in threads */
  targetSnippet: string | null;
  /** Nonce to force re-navigation when query/target haven't changed */
  nonce: number;
}

interface SearchActions {
  /** Called by global search panel on result click */
  activateSearch: (query: string, targetMatchIndex?: number, snippet?: string) => void;
  /** Called when the search panel closes/unmounts */
  deactivateSearch: () => void;
}

export const useSearchState = create<SearchState & SearchActions>((set) => ({
  isEnabled: false,
  searchQuery: "",
  targetMatchIndex: null,
  targetSnippet: null,
  nonce: 0,

  activateSearch: (query: string, targetMatchIndex?: number, snippet?: string) => {
    set((state) => ({
      isEnabled: true,
      searchQuery: query,
      targetMatchIndex: targetMatchIndex ?? null,
      targetSnippet: snippet ?? null,
      nonce: state.nonce + 1,
    }));
  },

  deactivateSearch: () => {
    set({
      isEnabled: false,
      searchQuery: "",
      targetMatchIndex: null,
      targetSnippet: null,
    });
  },
}));
