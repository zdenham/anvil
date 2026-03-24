/**
 * Canonical type definitions for the skills system.
 * These types are the single source of truth and should be imported
 * by all other packages via @core/types/skills.
 */

export type SkillSource =
  | 'project'           // <repo>/.claude/skills/
  | 'project_command'   // <repo>/.claude/commands/
  | 'anvil'             // ~/.anvil/skills/
  | 'personal'          // ~/.claude/skills/
  | 'personal_command'; // ~/.claude/commands/

/**
 * Full skill metadata - used by frontend for display and management.
 */
export interface SkillMetadata {
  name: string;                  // Display name (from frontmatter or directory name)
  slug: string;                  // Directory/file name for lookups (lowercase, serves as unique key)
  description: string;
  source: SkillSource;
  path: string;                  // Full path to SKILL.md or command.md
  isLegacyCommand: boolean;
  userInvocable: boolean;        // From frontmatter, default true
  disableModelInvocation: boolean; // From frontmatter, default false
}

/**
 * Minimal skill reference - used by agent for skill lookup.
 * This is a subset of SkillMetadata containing only fields needed for injection.
 */
export interface SkillReference {
  slug: string;                  // Directory/file name for lookups (lowercase)
  path: string;                  // Full path to SKILL.md or command.md
  source: SkillSource;
}

export interface SkillContent {
  content: string;      // Markdown content (frontmatter stripped)
  source: SkillSource;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'user-invocable'?: boolean;
  'disable-model-invocation'?: boolean;
  'argument-hint'?: string;
  'allowed-tools'?: string;
  model?: string;
  context?: 'fork';
  agent?: string;
}

/**
 * Result of parsing skill matches from a message.
 */
export interface SkillMatch {
  skillSlug: string;
  args: string;
  fullMatch: string;
}

/**
 * Result of processing a message for skill injection.
 */
export interface SkillInjection {
  displayMessage: string;           // Original message (stored in thread, shown in UI)
  userMessage: string;              // What goes in user message (same as display)
  systemPromptAppend: string | null; // What gets appended to system prompt
  skills: Array<{ slug: string; source: SkillSource }>;
}
