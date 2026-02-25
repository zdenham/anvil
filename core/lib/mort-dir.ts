import { join } from "path";
import { homedir } from "os";

/**
 * Get the path to the mort data directory.
 * Uses MORT_DATA_DIR env var if set, otherwise defaults to ~/.mort
 */
export function getMortDir(): string {
  const dir = process.env.MORT_DATA_DIR;
  if (!dir) {
    console.warn("[getMortDir] MORT_DATA_DIR not set, falling back to ~/.mort");
  }
  return dir ?? join(homedir(), ".mort");
}
