import { getBundledPluginPath, getMortDir } from './paths';
import { FilesystemClient } from './filesystem-client';
import { logger } from './logger-client';

const fs = new FilesystemClient();

/**
 * Sync managed skills from the bundled plugin to ~/.mort.
 *
 * - Copies .claude-plugin/plugin.json (always overwrites)
 * - Copies skills/* (overwrites existing managed skills, preserves user-created)
 * - Idempotent — safe to call on every startup
 */
export async function syncManagedSkills(): Promise<void> {
  const t0 = performance.now();

  let t = performance.now();
  const pluginSourcePath = await getBundledPluginPath();
  const mortDir = await getMortDir();
  logger.info(`[startup:skill-sync] resolve paths: ${(performance.now() - t).toFixed(0)}ms`);

  // 1. Sync .claude-plugin/plugin.json
  t = performance.now();
  const srcPluginJson = `${pluginSourcePath}/.claude-plugin/plugin.json`;
  const dstPluginJson = `${mortDir}/.claude-plugin/plugin.json`;
  await fs.mkdir(`${mortDir}/.claude-plugin`);
  await fs.copyFile(srcPluginJson, dstPluginJson);
  logger.info(`[startup:skill-sync] copy plugin.json: ${(performance.now() - t).toFixed(0)}ms`);

  // 2. Sync skills directory
  t = performance.now();
  const srcSkillsDir = `${pluginSourcePath}/skills`;
  const dstSkillsDir = `${mortDir}/skills`;
  await fs.mkdir(dstSkillsDir);

  const sourceSkills = await fs.listDir(srcSkillsDir);
  for (const entry of sourceSkills) {
    if (entry.isDirectory) {
      const ts = performance.now();
      await copySkillDirectory(
        `${srcSkillsDir}/${entry.name}`,
        `${dstSkillsDir}/${entry.name}`
      );
      logger.info(`[startup:skill-sync]   skill ${entry.name}: ${(performance.now() - ts).toFixed(0)}ms`);
    }
  }
  logger.info(`[startup:skill-sync] copy skills dir: ${(performance.now() - t).toFixed(0)}ms`);

  logger.info(`[startup:skill-sync] total: ${(performance.now() - t0).toFixed(0)}ms`);
}

async function copySkillDirectory(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst);
  const entries = await fs.listDir(src);
  for (const entry of entries) {
    if (entry.isDirectory) {
      await copySkillDirectory(`${src}/${entry.name}`, `${dst}/${entry.name}`);
    } else {
      await fs.copyFile(`${src}/${entry.name}`, `${dst}/${entry.name}`);
    }
  }
}
