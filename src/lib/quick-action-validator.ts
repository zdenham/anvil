/**
 * Quick Action Project Validator
 *
 * Validates quick action projects before execution.
 * Checks manifest existence, schema validity, and entry point availability.
 */

import { FilesystemClient } from './filesystem-client.js';
import { QuickActionManifestSchema, type QuickActionManifest } from '@core/types/quick-actions.js';

const fs = new FilesystemClient();

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: QuickActionManifest;
}

/**
 * Validates a quick action project directory.
 *
 * Checks:
 * - Directory exists
 * - dist/manifest.json exists and is valid
 * - All entry points referenced in manifest exist
 * - package.json exists (warning only)
 *
 * @param projectPath - Absolute path to the quick action project
 * @returns ValidationResult with validity status and any errors/warnings
 */
export async function validateQuickActionProject(
  projectPath: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check directory exists
  try {
    const exists = await fs.exists(projectPath);
    if (!exists) {
      return { valid: false, errors: ['Directory does not exist'], warnings };
    }
  } catch {
    return { valid: false, errors: ['Failed to check if directory exists'], warnings };
  }

  // Check manifest exists
  const manifestPath = fs.joinPath(projectPath, 'dist', 'manifest.json');
  try {
    const manifestExists = await fs.exists(manifestPath);
    if (!manifestExists) {
      return {
        valid: false,
        errors: ['No dist/manifest.json found. Run `npm run build` first.'],
        warnings,
      };
    }
  } catch {
    return {
      valid: false,
      errors: ['Failed to check manifest existence'],
      warnings,
    };
  }

  // Parse and validate manifest
  let manifest: QuickActionManifest;
  try {
    const content = await fs.readFile(manifestPath);
    const parsed = JSON.parse(content);
    manifest = QuickActionManifestSchema.parse(parsed);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid manifest.json: ${e instanceof Error ? e.message : String(e)}`],
      warnings,
    };
  }

  // Check all entry points exist
  for (const action of manifest.actions) {
    const entryPath = fs.joinPath(projectPath, 'dist', action.entryPoint);
    try {
      const entryExists = await fs.exists(entryPath);
      if (!entryExists) {
        errors.push(`Missing entry point: ${action.entryPoint}`);
      }
    } catch {
      errors.push(`Failed to check entry point: ${action.entryPoint}`);
    }
  }

  // Check for common issues
  try {
    const packageJsonPath = fs.joinPath(projectPath, 'package.json');
    const packageJsonExists = await fs.exists(packageJsonPath);
    if (!packageJsonExists) {
      warnings.push('No package.json found - is this a valid project?');
    }
  } catch {
    // Ignore - just a warning check
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : undefined,
  };
}
