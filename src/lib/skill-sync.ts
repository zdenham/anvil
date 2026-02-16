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
  const pluginSourcePath = await getBundledPluginPath();
  const mortDir = await getMortDir();

  // 1. Sync .claude-plugin/plugin.json
  const srcPluginJson = `${pluginSourcePath}/.claude-plugin/plugin.json`;
  const dstPluginJson = `${mortDir}/.claude-plugin/plugin.json`;
  await fs.mkdir(`${mortDir}/.claude-plugin`);
  await fs.copyFile(srcPluginJson, dstPluginJson);

  // 2. Sync skills directory
  const srcSkillsDir = `${pluginSourcePath}/skills`;
  const dstSkillsDir = `${mortDir}/skills`;
  await fs.mkdir(dstSkillsDir);

  // Read source skill directories and copy each one
  const sourceSkills = await fs.listDir(srcSkillsDir);
  for (const entry of sourceSkills) {
    if (entry.isDirectory) {
      await copySkillDirectory(
        `${srcSkillsDir}/${entry.name}`,
        `${dstSkillsDir}/${entry.name}`
      );
    }
  }

  logger.log(`[skill-sync] Synced managed skills to ${mortDir}`);
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
