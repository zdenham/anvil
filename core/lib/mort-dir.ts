import { join } from "path";
import { homedir } from "os";

/**
 * Get the path to the mort data directory.
 * Uses MORT_DATA_DIR env var if set, otherwise defaults to ~/.mort
 */
export function getMortDir(): string {
  return process.env.MORT_DATA_DIR ?? join(homedir(), ".mort");
}
