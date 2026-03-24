/**
 * Centralized path resolution for the sidecar.
 *
 * Uses ANVIL_DATA_DIR env var, or derives from ANVIL_APP_SUFFIX, or defaults to ~/.anvil.
 */

import { homedir } from "node:os";
import { join } from "node:path";

function suffixedName(base: string): string {
  const suffix = process.env.ANVIL_APP_SUFFIX ?? "";
  return suffix ? `${base}-${suffix}` : base;
}

export function dataDirPath(): string {
  return process.env.ANVIL_DATA_DIR ?? join(homedir(), suffixedName(".anvil"));
}

export function configDirPath(): string {
  if (process.env.ANVIL_CONFIG_DIR) {
    return process.env.ANVIL_CONFIG_DIR;
  }
  // macOS: ~/Library/Application Support/anvil[-suffix]
  return join(
    homedir(),
    "Library",
    "Application Support",
    suffixedName("anvil"),
  );
}

export function repositoriesDirPath(): string {
  return join(dataDirPath(), "repositories");
}

export function threadsDirPath(): string {
  return join(dataDirPath(), "threads");
}

export function settingsDirPath(): string {
  return join(dataDirPath(), "settings");
}

export function homeDirPath(): string {
  return homedir();
}
