import { z } from 'zod';

export const DraftsFileSchema = z.object({
  threads: z.record(z.string(), z.string()),  // threadId -> draft content
  plans: z.record(z.string(), z.string()),     // planId -> draft content
  empty: z.string().default(''),               // draft for empty state
});

export type DraftsFile = z.infer<typeof DraftsFileSchema>;
