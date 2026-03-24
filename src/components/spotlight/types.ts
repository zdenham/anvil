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

/** Internal type - thread creation result */
export interface ThreadCreationResult {
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

/** Internal type - open anvil action */
export interface OpenAnvilResult {
  action: "open-anvil";
}

/** Internal type - open threads list action */
export interface OpenThreadsResult {
  action: "open-threads";
}

/** Internal type - refresh action (dev only) */
export interface RefreshResult {
  action: "refresh";
}

/** Internal type - action result discriminated union */
export type ActionResult = OpenRepoResult | OpenAnvilResult | OpenThreadsResult | RefreshResult;

/** File mention result from @ trigger */
export interface FileResult {
  path: string;          // Full relative path (e.g., "src/components/foo.tsx")
  insertText: string;    // What to insert (e.g., "@src/components/foo.tsx")
}

/** History entry result from prompt history */
export interface HistoryResult {
  prompt: string;        // The historical prompt
  timestamp: number;     // When it was created
  isDraft: boolean;      // Whether this is a draft (no threadId)
}

/** Internal type - spotlight result discriminated union */
export type SpotlightResult =
  | { type: "app"; data: AppResult }
  | { type: "calculator"; data: CalculatorResult }
  | { type: "thread"; data: ThreadCreationResult }
  | { type: "action"; data: ActionResult }
  | { type: "file"; data: FileResult }
  | { type: "history"; data: HistoryResult };
