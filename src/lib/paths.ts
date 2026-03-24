/**
 * Path utilities for Anvil application resources and directories.
 *
 * Provides helpers for resolving:
 * - Quick actions template directory (bundled with app)
 * - Quick actions project directory (~/.anvil/quick-actions)
 * - SDK runner script (bundled with app)
 * - SDK types file (bundled with app)
 */

import { resolveResource } from '@tauri-apps/api/path';
import { FilesystemClient } from './filesystem-client';

const fs = new FilesystemClient();

/**
 * Gets the path to the quick actions template directory.
 * In production, this is bundled with the app.
 * In development, it's in the source tree.
 */
export async function getQuickActionsTemplatePath(): Promise<string> {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    // Development: use source directory
    return `${__PROJECT_ROOT__}/core/sdk/template`;
  }

  // Production: resolve from bundled resources
  // The _up_ prefix navigates from src-tauri to the project root
  const resourceDir = await resolveResource('_up_/core/sdk/template');
  return resourceDir;
}

/**
 * Gets the path to the user's quick actions project.
 * Located at ~/.anvil/quick-actions (or ~/.anvil-dev/quick-actions in dev).
 */
export async function getQuickActionsProjectPath(): Promise<string> {
  const anvilDir = await fs.getDataDir();
  return fs.joinPath(anvilDir, 'quick-actions');
}

/**
 * Gets the path to the SDK runner script.
 * The runner executes user actions with the SDK injected at runtime (per DD #4).
 */
export async function getRunnerPath(): Promise<string> {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    // Development: use built sdk-runner.mjs at project root
    // Build it with: cd core/sdk && pnpm build
    return `${__PROJECT_ROOT__}/sdk-runner.mjs`;
  }

  // Production: resolve from bundled resources (compiled JS)
  const runnerPath = await resolveResource('_up_/sdk-runner.mjs');
  return runnerPath;
}

/**
 * Gets the path to the SDK types.d.ts file.
 * Per DD #4 and DD #22, this is the only SDK file shipped to user projects.
 * The actual SDK implementation is injected at runtime by the runner.
 */
export async function getSdkTypesPath(): Promise<string> {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    // Development: use the dist/index.d.ts from the SDK
    return `${__PROJECT_ROOT__}/core/sdk/dist/index.d.ts`;
  }

  // Production: resolve from bundled resources
  const typesPath = await resolveResource('_up_/sdk-types.d.ts');
  return typesPath;
}

/**
 * Gets the .anvil data directory path.
 * This is a convenience export that delegates to FilesystemClient.
 */
export async function getAnvilDir(): Promise<string> {
  return fs.getDataDir();
}

/**
 * Gets the path to the bundled Anvil plugin source directory.
 * In dev: points at the repo's plugins/mort/ directly.
 * In production: resolves from Tauri's bundled resources.
 */
export async function getBundledPluginPath(): Promise<string> {
  const isDev = import.meta.env.DEV;

  if (isDev) {
    return `${__PROJECT_ROOT__}/plugins/mort`;
  }

  // Production: resolve from bundled resources
  const pluginJsonPath = await resolveResource('_up_/plugins/mort/.claude-plugin/plugin.json');
  // Walk up from .claude-plugin/plugin.json to get the plugin root
  const claudePluginDir = pluginJsonPath.replace(/\/plugin\.json$/, '');
  return claudePluginDir.replace(/\/\.claude-plugin$/, '');
}
