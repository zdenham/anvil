import { FilesystemClient } from "./filesystem-client";

const SETTINGS_DIR = "settings";

/**
 * Client for managing settings in the data directory.
 * Each setting is stored as a separate JSON file.
 */
export class SettingsStoreClient {
  private fs: FilesystemClient;
  private settingsDir: string | null = null;

  constructor(fs: FilesystemClient) {
    this.fs = fs;
  }

  /**
   * Ensures the settings directory exists
   */
  async bootstrap(): Promise<void> {
    const settingsDir = await this.getSettingsDir();
    await this.fs.mkdir(settingsDir);
  }

  /**
   * Gets the settings directory path, caching it for performance
   */
  private async getSettingsDir(): Promise<string> {
    if (!this.settingsDir) {
      const dataDir = await this.fs.getDataDir();
      this.settingsDir = this.fs.joinPath(dataDir, SETTINGS_DIR);
    }
    return this.settingsDir;
  }

  /**
   * Gets the path to a settings file
   */
  private async getSettingPath(key: string): Promise<string> {
    const settingsDir = await this.getSettingsDir();
    return this.fs.joinPath(settingsDir, `${key}.json`);
  }

  /**
   * Gets a setting value by key
   * Returns null if the setting doesn't exist
   */
  async get<T>(key: string): Promise<T | null> {
    const path = await this.getSettingPath(key);

    if (!(await this.fs.exists(path))) {
      return null;
    }

    try {
      return await this.fs.readJsonFile<T>(path);
    } catch {
      return null;
    }
  }

  /**
   * Gets a setting value with a default fallback
   */
  async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
    const value = await this.get<T>(key);
    return value ?? defaultValue;
  }

  /**
   * Sets a setting value
   */
  async set<T>(key: string, value: T): Promise<void> {
    const path = await this.getSettingPath(key);
    await this.fs.writeJsonFile(path, value);
  }

  /**
   * Deletes a setting
   */
  async delete(key: string): Promise<void> {
    const path = await this.getSettingPath(key);

    if (await this.fs.exists(path)) {
      await this.fs.remove(path);
    }
  }

  /**
   * Checks if a setting exists
   */
  async has(key: string): Promise<boolean> {
    const path = await this.getSettingPath(key);
    return this.fs.exists(path);
  }

  /**
   * Lists all setting keys
   */
  async keys(): Promise<string[]> {
    const settingsDir = await this.getSettingsDir();

    if (!(await this.fs.exists(settingsDir))) {
      return [];
    }

    const entries = await this.fs.listDir(settingsDir);
    return entries
      .filter((e) => e.isFile && e.name.endsWith(".json"))
      .map((e) => e.name.replace(/\.json$/, ""));
  }

  /**
   * Gets all settings as a key-value map
   */
  async getAll(): Promise<Record<string, unknown>> {
    const keys = await this.keys();
    const result: Record<string, unknown> = {};

    for (const key of keys) {
      result[key] = await this.get(key);
    }

    return result;
  }
}
