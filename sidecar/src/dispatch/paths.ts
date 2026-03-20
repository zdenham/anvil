/**
 * Centralized path resolution for the sidecar.
 *
 * Uses MORT_DATA_DIR env var, or derives from MORT_APP_SUFFIX, or defaults to ~/.mort.
 */

import { homedir } from "node:os";
import { join } from "node:path";

function suffixedName(base: string): string {
  const suffix = process.env.MORT_APP_SUFFIX ?? "";
  return suffix ? `${base}-${suffix}` : base;
}

export function dataDirPath(): string {
  return process.env.MORT_DATA_DIR ?? join(homedir(), suffixedName(".mort"));
}

export function configDirPath(): string {
  if (process.env.MORT_CONFIG_DIR) {
    return process.env.MORT_CONFIG_DIR;
  }
  // macOS: ~/Library/Application Support/mortician[-suffix]
  return join(
    homedir(),
    "Library",
    "Application Support",
    suffixedName("mortician"),
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
