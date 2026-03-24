import { join } from "path";
import { homedir } from "os";

/**
 * Get the path to the anvil data directory.
 * Uses ANVIL_DATA_DIR env var if set, otherwise defaults to ~/.anvil
 */
export function getAnvilDir(): string {
  return process.env.ANVIL_DATA_DIR ?? join(homedir(), ".anvil");
}
