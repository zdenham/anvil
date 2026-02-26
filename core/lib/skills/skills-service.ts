import type { FSAdapter, DirEntry } from '@core/services/fs-adapter.js';
import type { SkillMetadata, SkillSource, SkillContent } from '@core/types/skills.js';
import { parseFrontmatter, SOURCE_PRIORITY, scoreMatch } from '@core/skills/index.js';

interface SkillLocation {
  getPath: (repoPath: string, homeDir: string, mortDataDir: string) => string;
  source: SkillSource;
  isLegacy: boolean;
}

/**
 * Skill location configuration.
 * Order determines discovery priority (first match wins for duplicate slugs).
 */
const SKILL_LOCATIONS: SkillLocation[] = [
  { getPath: (repo) => `${repo}/.claude/skills`, source: 'project', isLegacy: false },
  { getPath: (repo) => `${repo}/.claude/commands`, source: 'project_command', isLegacy: true },
  { getPath: (_, _home, mortDir) => `${mortDir}/skills`, source: 'mort', isLegacy: false },
  { getPath: (_, home) => `${home}/.claude/skills`, source: 'personal', isLegacy: false },
  { getPath: (_, home) => `${home}/.claude/commands`, source: 'personal_command', isLegacy: true },
];

/**
 * SkillsService - single implementation with injected filesystem adapter.
 *
 * This service contains ALL business logic for skill discovery, parsing, and management.
 * The filesystem adapter provides only low-level operations, allowing the same business
 * logic to run in both frontend (Tauri) and agent (Node.js) environments.
 *
 * Usage:
 *   // In frontend (Tauri)
 *   const service = new SkillsService(tauriFsAdapter);
 *
 *   // In agent (Node.js)
 *   const service = new SkillsService(nodeFsAdapter);
 */
export class SkillsService {
  private skills: Map<string, SkillMetadata> = new Map();
  private slugIndex: Map<string, string> = new Map();
  private lastDiscoveryPath: string | null = null;

  constructor(private fs: FSAdapter) {}

  /**
   * Discover all skills from configured locations.
   * Scans project and personal skill directories, parsing frontmatter
   * and building an index of available skills.
   *
   * @param repoPath - Path to the current repository
   * @param homeDir - Path to user's home directory
   * @param mortDataDir - Path to mort data directory (e.g. ~/.mort or ~/.mort-dev)
   * @returns Array of discovered skill metadata, sorted by priority
   */
  async discover(repoPath: string, homeDir: string, mortDataDir: string): Promise<SkillMetadata[]> {
    this.skills.clear();
    this.slugIndex.clear();
    this.lastDiscoveryPath = repoPath;

    for (const location of SKILL_LOCATIONS) {
      const dirPath = location.getPath(repoPath, homeDir, mortDataDir);

      if (!await this.fs.exists(dirPath)) {
        continue;
      }

      try {
        const entries = await this.fs.listDirWithMetadata(dirPath);

        for (const entry of entries) {
          await this.processEntry(entry, location, dirPath);
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    return this.getAll();
  }

  /**
   * Process a single directory entry, determining if it's a valid skill
   * and adding it to the index if so.
   */
  private async processEntry(
    entry: DirEntry,
    location: SkillLocation,
    _dirPath: string
  ): Promise<void> {
    let skillPath: string;
    let slug: string;

    if (location.isLegacy) {
      // Legacy commands: single .md files directly in commands/
      if (!entry.isFile || !entry.name.endsWith('.md')) return;
      skillPath = entry.path;
      slug = entry.name.replace(/\.md$/, '').toLowerCase();
    } else {
      // Modern skills: directories containing SKILL.md
      if (!entry.isDirectory) return;
      skillPath = this.fs.joinPath(entry.path, 'SKILL.md');
      if (!await this.fs.exists(skillPath)) return;
      slug = entry.name.toLowerCase();
    }

    // Skip if we already have a skill with this slug (higher priority wins)
    if (this.slugIndex.has(slug)) return;

    try {
      const content = await this.fs.readFile(skillPath);
      const { frontmatter } = parseFrontmatter(content);

      // Skip non-user-invocable skills
      if (frontmatter['user-invocable'] === false) return;

      const id = crypto.randomUUID();
      this.slugIndex.set(slug, id);

      this.skills.set(id, {
        id,
        slug,
        name: frontmatter.name || slug,
        description: frontmatter.description || '',
        source: location.source,
        path: skillPath,
        isLegacyCommand: location.isLegacy,
        userInvocable: frontmatter['user-invocable'] ?? true,
        disableModelInvocation: frontmatter['disable-model-invocation'] ?? false,
      });
    } catch {
      // Skip malformed skills
    }
  }

  /**
   * Get a skill by its ID.
   */
  getById(id: string): SkillMetadata | undefined {
    return this.skills.get(id);
  }

  /**
   * Get a skill by its slug (case-insensitive).
   */
  getBySlug(slug: string): SkillMetadata | undefined {
    const id = this.slugIndex.get(slug.toLowerCase());
    return id ? this.skills.get(id) : undefined;
  }

  /**
   * Get all user-invocable skills, sorted by source priority and name.
   */
  getAll(): SkillMetadata[] {
    const order: Record<SkillSource, number> = SOURCE_PRIORITY.reduce(
      (acc, source, index) => ({ ...acc, [source]: index }),
      {} as Record<SkillSource, number>
    );
    return Array.from(this.skills.values())
      .filter(s => s.userInvocable)
      .sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
  }

  /**
   * Search skills by name or description.
   */
  search(query: string): SkillMetadata[] {
    const q = query.toLowerCase();
    return this.getAll()
      .map(skill => ({ skill, score: scoreMatch(skill, q) }))
      .filter(({ score }) => score < Infinity)
      .sort((a, b) => a.score - b.score)
      .map(({ skill }) => skill);
  }

  /**
   * Read the content of a skill (with frontmatter stripped).
   */
  async readContent(slug: string): Promise<SkillContent | null> {
    const skill = this.getBySlug(slug);
    if (!skill) return null;

    try {
      const raw = await this.fs.readFile(skill.path);
      const { body } = parseFrontmatter(raw);
      return { content: body, source: skill.source };
    } catch {
      return null;
    }
  }

  /**
   * Check if re-discovery is needed (e.g., repo changed).
   */
  needsRediscovery(repoPath: string): boolean {
    return this.lastDiscoveryPath !== repoPath;
  }

  /**
   * Get the path where the last discovery was performed.
   */
  getLastDiscoveryPath(): string | null {
    return this.lastDiscoveryPath;
  }

  /**
   * Get the count of discovered skills.
   */
  getCount(): number {
    return this.skills.size;
  }
}
