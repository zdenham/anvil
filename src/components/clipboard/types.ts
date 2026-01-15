import { z } from "zod";

/** Schema for lightweight clipboard entry (for list display, no full content) */
export const ClipboardEntryPreviewSchema = z.object({
  id: z.string(),
  preview: z.string(),
  content_size: z.number(),
  timestamp: z.number(),
  app_source: z.string().nullable(),
});
export type ClipboardEntryPreview = z.infer<typeof ClipboardEntryPreviewSchema>;

/** Schema for full clipboard entry with content (for preview panel) */
export const ClipboardEntrySchema = ClipboardEntryPreviewSchema.extend({
  content: z.string(),
});
export type ClipboardEntry = z.infer<typeof ClipboardEntrySchema>;
