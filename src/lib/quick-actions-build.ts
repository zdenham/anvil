/**
 * Quick Actions Build
 *
 * Builds the user's quick actions project (~/.mort/quick-actions) by running
 * `pnpm build`. Handles auto-installing dependencies when node_modules is
 * missing. Includes a module-level lock to prevent concurrent builds.
 */

import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@/lib/invoke';
import { quickActionService } from '@/entities/quick-actions/service.js';
import { logger } from '@/lib/logger-client.js';
import { getQuickActionsProjectPath } from '@/lib/paths.js';
import { FilesystemClient } from './filesystem-client';

const fs = new FilesystemClient();

let building = false;

export async function buildQuickActions(): Promise<{ success: boolean; error?: string }> {
  if (building) {
    logger.info('[quick-actions-build] Build already in progress, skipping');
    return { success: false, error: 'Build already in progress' };
  }

  building = true;
  try {
    return await runBuild();
  } finally {
    building = false;
  }
}

async function runBuild(): Promise<{ success: boolean; error?: string }> {
  const projectPath = await getQuickActionsProjectPath();

  const projectExists = await fs.exists(projectPath);
  if (!projectExists) {
    logger.info('[quick-actions-build] Project path does not exist, skipping build');
    return { success: false, error: 'Quick actions project not found' };
  }

  const shellPath = await invoke<string>('get_shell_path');
  const env = { PATH: shellPath };

  // Phase 4: auto-install dependencies if node_modules is missing
  const nodeModulesExists = await fs.exists(fs.joinPath(projectPath, 'node_modules'));
  if (!nodeModulesExists) {
    logger.info('[quick-actions-build] Installing dependencies...');
    const installCmd = Command.create('pnpm', ['--dir', projectPath, 'install'], { env });
    const installResult = await installCmd.execute();
    if (installResult.code !== 0) {
      const error = 'pnpm install failed: ' + installResult.stderr;
      logger.error('[quick-actions-build] ' + error);
      return { success: false, error };
    }
  }

  logger.info('[quick-actions-build] Building quick actions...');
  const buildCmd = Command.create('pnpm', ['--dir', projectPath, 'build'], { env });
  const buildResult = await buildCmd.execute();

  if (buildResult.code !== 0) {
    const error = buildResult.stderr || 'Build exited with code ' + buildResult.code;
    logger.error('[quick-actions-build] Build failed', { stderr: buildResult.stderr, stdout: buildResult.stdout });
    return { success: false, error };
  }

  logger.info('[quick-actions-build] Build succeeded, reloading manifest');
  await quickActionService.reloadManifest();
  return { success: true };
}
