import { createContext, useContext } from "react";
import type { ToolDiffData } from "./use-tool-diff";

interface ToolPermissionContextValue {
  isPending: boolean;
  diffData: ToolDiffData | null;
}

const ToolPermissionContext = createContext<ToolPermissionContextValue | null>(null);

export const ToolPermissionProvider = ToolPermissionContext.Provider;

export function useToolPermission() {
  return useContext(ToolPermissionContext);
}
