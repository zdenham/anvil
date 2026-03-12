/**
 * SplitTreeScope — React context for identifying which split tree
 * (content vs terminal) a component lives in.
 *
 * Used by SplitResizeHandle to call the correct resize service method.
 */

import { createContext, useContext } from "react";

export type SplitTreeScope = "content" | "terminal";

const SplitTreeScopeContext = createContext<SplitTreeScope>("content");

export const SplitTreeScopeProvider = SplitTreeScopeContext.Provider;

export function useSplitTreeScope(): SplitTreeScope {
  return useContext(SplitTreeScopeContext);
}
