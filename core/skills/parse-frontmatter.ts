import type { SkillFrontmatter } from '@core/types/skills.js';

export interface ParsedFrontmatter {
  frontmatter: SkillFrontmatter;
  body: string;
}

/**
 * Parse YAML frontmatter from skill content.
 *
 * Supports standard YAML frontmatter delimited by `---`:
 * ```
 * ---
 * name: My Skill
 * description: Does something useful
 * ---
 * # Skill content here
 * ```
 *
 * This is a simple parser that handles key: value pairs only.
 * It does NOT support:
 * - Nested objects
 * - Arrays (except inline in allowed-tools)
 * - Multi-line strings
 * - YAML anchors/aliases
 *
 * @param content - Raw skill file content
 * @returns Parsed frontmatter and body content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  const frontmatter: SkillFrontmatter = {};
  for (const line of yamlContent.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      const cleanKey = key.trim();
      const cleanValue = value.trim().replace(/^["']|["']$/g, '');

      switch (cleanKey) {
        case 'name':
          frontmatter.name = cleanValue;
          break;
        case 'description':
          frontmatter.description = cleanValue;
          break;
        case 'user-invocable':
          frontmatter['user-invocable'] = cleanValue !== 'false';
          break;
        case 'disable-model-invocation':
          frontmatter['disable-model-invocation'] = cleanValue === 'true';
          break;
        case 'argument-hint':
          frontmatter['argument-hint'] = cleanValue;
          break;
        case 'allowed-tools':
          frontmatter['allowed-tools'] = cleanValue;
          break;
        case 'model':
          frontmatter.model = cleanValue;
          break;
        case 'context':
          if (cleanValue === 'fork') frontmatter.context = 'fork';
          break;
        case 'agent':
          frontmatter.agent = cleanValue;
          break;
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Extract only the body content, stripping frontmatter.
 * Use when you don't need the frontmatter data.
 *
 * @param content - Raw skill file content
 * @returns Body content with frontmatter removed
 */
export function stripFrontmatter(content: string): string {
  return parseFrontmatter(content).body;
}
