import { z } from "zod";

export const InlineCommentSchema = z.object({
  id: z.string().uuid(),
  worktreeId: z.string().uuid(),
  threadId: z.string().uuid().nullable(),
  filePath: z.string(),
  lineNumber: z.number().int(),
  lineType: z.enum(["addition", "deletion", "unchanged"]),
  content: z.string().min(1),
  resolved: z.boolean().default(false),
  resolvedAt: z.number().nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type InlineComment = z.infer<typeof InlineCommentSchema>;

export const CommentsFileSchema = z.object({
  version: z.literal(1),
  comments: z.array(InlineCommentSchema),
});
export type CommentsFile = z.infer<typeof CommentsFileSchema>;
