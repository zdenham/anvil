import { z } from "zod";

/** Schema for app result from IPC (search_applications command) */
export const AppResultSchema = z.object({
  name: z.string(),
  path: z.string(),
  icon_path: z.string().nullable(),
});
export type AppResult = z.infer<typeof AppResultSchema>;

/** Internal type - calculator evaluation result */
export interface CalculatorResult {
  displayExpression: string;
  result: number | null;
  isValid: boolean;
}

/** Internal type - task creation result */
export interface TaskResult {
  query: string;
  selectedWorktree?: {
    path: string;
    name: string;
  };
}

/** Internal type - open repository action */
export interface OpenRepoResult {
  action: "open-repo";
}

/** Internal type - open mort action */
export interface OpenMortResult {
  action: "open-mort";
}

/** Internal type - open tasks list action */
export interface OpenTasksResult {
  action: "open-tasks";
}

/** Internal type - refresh action (dev only) */
export interface RefreshResult {
  action: "refresh";
}

/** Internal type - action result discriminated union */
export type ActionResult = OpenRepoResult | OpenMortResult | OpenTasksResult | RefreshResult;

/** File mention result from @ trigger */
export interface FileResult {
  path: string;          // Full relative path (e.g., "src/components/foo.tsx")
  insertText: string;    // What to insert (e.g., "@src/components/foo.tsx")
}

/** History entry result from prompt history */
export interface HistoryResult {
  prompt: string;        // The historical prompt
  timestamp: number;     // When it was created
  isDraft: boolean;      // Whether this is a draft (no taskId)
}

/** Internal type - spotlight result discriminated union */
export type SpotlightResult =
  | { type: "app"; data: AppResult }
  | { type: "calculator"; data: CalculatorResult }
  | { type: "task"; data: TaskResult }
  | { type: "action"; data: ActionResult }
  | { type: "file"; data: FileResult }
  | { type: "history"; data: HistoryResult };
