import { z } from "zod";

/**
 * Schema for paths info from the Tauri backend.
 * Used to validate IPC responses from `get_paths_info` command.
 */
export const PathsInfoSchema = z.object({
  data_dir: z.string(),
  config_dir: z.string(),
  app_suffix: z.string(),
  is_alternate_build: z.boolean(),
});
export type PathsInfo = z.infer<typeof PathsInfoSchema>;
