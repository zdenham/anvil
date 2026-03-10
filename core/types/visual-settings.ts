import { z } from "zod";

export const VisualSettingsSchema = z.object({
  /** Visual tree parent ID. Undefined = tree root (worktrees) or worktree root (new items). */
  parentId: z.string().optional(),
  /** Lexicographic sort key for ordering within parent. Undefined = sort by createdAt. */
  sortKey: z.string().optional(),
});

export type VisualSettings = z.infer<typeof VisualSettingsSchema>;
