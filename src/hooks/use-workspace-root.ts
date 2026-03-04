import { createContext, useContext } from "react";

const WorkspaceRootContext = createContext<string>("");

/** Provider — placed in AssistantMessage, fed from the workingDirectory prop */
export const WorkspaceRootProvider = WorkspaceRootContext.Provider;

/** Consumer — used by tool blocks, no args needed */
export function useWorkspaceRoot(): string {
  return useContext(WorkspaceRootContext);
}
