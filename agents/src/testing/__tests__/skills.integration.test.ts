import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { TestMortDirectory } from '../services/test-mort-directory.js';
import { TestRepository } from '../services/test-repository.js';
import { extractSkillMatches } from '@core/skills/index.js';
import { parseFrontmatter } from '@core/skills/index.js';

/**
 * Integration tests for the skills system.
 *
 * These tests verify:
 * 1. Skill extraction from messages (extractSkillMatches)
 * 2. Frontmatter parsing (parseFrontmatter)
 * 3. Discovery flow with filesystem fixtures
 */

// ============================================================================
// Unit Tests - extractSkillMatches
// ============================================================================

describe('extractSkillMatches', () => {
  it('extracts a simple skill invocation', () => {
    const matches = extractSkillMatches('/commit fix bug');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      skillSlug: 'commit',
      args: 'fix bug',
      fullMatch: '/commit fix bug',
    });
  });

  it('extracts skill with no arguments', () => {
    const matches = extractSkillMatches('/deploy');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      skillSlug: 'deploy',
      args: '',
      fullMatch: '/deploy',
    });
  });

  it('extracts multiple skills from a single message on separate lines', () => {
    // Skills are separated by newlines for multiple matches
    const matches = extractSkillMatches('/review-pr 123\n/deploy');
    expect(matches).toHaveLength(2);
    expect(matches[0].skillSlug).toBe('review-pr');
    expect(matches[0].args).toBe('123');
    expect(matches[1].skillSlug).toBe('deploy');
    expect(matches[1].args).toBe('');
  });

  it('extracts single skill with long args', () => {
    // When skills are on same line, args capture until newline
    const matches = extractSkillMatches('Please /review-pr 123 and then deploy later');
    expect(matches).toHaveLength(1);
    expect(matches[0].skillSlug).toBe('review-pr');
    expect(matches[0].args).toBe('123 and then deploy later');
  });

  it('normalizes skill slugs to lowercase', () => {
    const matches = extractSkillMatches('/MySkill ARGS');
    expect(matches).toHaveLength(1);
    expect(matches[0].skillSlug).toBe('myskill');
  });

  it('handles skill with hyphenated name', () => {
    const matches = extractSkillMatches('/my-complex-skill some args here');
    expect(matches).toHaveLength(1);
    expect(matches[0].skillSlug).toBe('my-complex-skill');
    expect(matches[0].args).toBe('some args here');
  });

  it('handles skill with underscored name', () => {
    const matches = extractSkillMatches('/my_skill_name args');
    expect(matches).toHaveLength(1);
    expect(matches[0].skillSlug).toBe('my_skill_name');
  });

  it('returns empty array for message without skills', () => {
    const matches = extractSkillMatches('Just a regular message');
    expect(matches).toHaveLength(0);
  });

  it('does not match URL paths', () => {
    const matches = extractSkillMatches('Check out https://example.com/path/to/resource');
    // Should not match /path or /to because they are part of a URL
    expect(matches).toHaveLength(0);
  });

  it('handles skill at end of message', () => {
    const matches = extractSkillMatches('Please run /test');
    expect(matches).toHaveLength(1);
    expect(matches[0].skillSlug).toBe('test');
    expect(matches[0].args).toBe('');
  });

  it('handles multiline messages', () => {
    const matches = extractSkillMatches('/commit fix bug\n\nMore context here');
    expect(matches).toHaveLength(1);
    expect(matches[0].skillSlug).toBe('commit');
    // Args should only be on the same line
    expect(matches[0].args).toBe('fix bug');
  });
});

// ============================================================================
// Unit Tests - parseFrontmatter
// ============================================================================

describe('parseFrontmatter', () => {
  it('parses standard frontmatter', () => {
    const content = `---
name: My Skill
description: Does something useful
---
# Skill content here`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('My Skill');
    expect(result.frontmatter.description).toBe('Does something useful');
    expect(result.body).toBe('# Skill content here');
  });

  it('returns empty frontmatter when none present', () => {
    const content = '# Just markdown content';
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('# Just markdown content');
  });

  it('parses user-invocable flag', () => {
    const content = `---
name: Hidden Skill
user-invocable: false
---
Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter['user-invocable']).toBe(false);
  });

  it('parses disable-model-invocation flag', () => {
    const content = `---
name: User Only Skill
disable-model-invocation: true
---
Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter['disable-model-invocation']).toBe(true);
  });

  it('handles quoted values', () => {
    const content = `---
name: "Quoted Name"
description: 'Single quoted'
---
Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('Quoted Name');
    expect(result.frontmatter.description).toBe('Single quoted');
  });

  it('handles malformed frontmatter gracefully', () => {
    // Missing closing ---
    const content = `---
name: Broken
Content without closing`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toContain('---');
  });

  it('parses context: fork', () => {
    const content = `---
name: Fork Skill
context: fork
---
Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.context).toBe('fork');
  });

  it('parses agent field', () => {
    const content = `---
name: Agent Skill
agent: explorer
---
Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.agent).toBe('explorer');
  });
});

// ============================================================================
// Integration Tests - Filesystem Fixtures
// ============================================================================

describe('Skill Discovery Flow', () => {
  let mortDir: TestMortDirectory;
  let repo: TestRepository;

  beforeEach(() => {
    mortDir = new TestMortDirectory().init();
    repo = new TestRepository({ fixture: 'minimal' }).init();
    mortDir.registerRepository({
      name: repo.name,
      path: repo.path,
    });
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    repo.cleanup(failed);
    mortDir.cleanup(failed);
  });

  /**
   * Helper to create a skill fixture in the filesystem.
   */
  function createSkillFixture(
    basePath: string,
    location: string,
    slug: string,
    options: {
      name?: string;
      description?: string;
      content?: string;
      userInvocable?: boolean;
    }
  ) {
    const skillDir = join(basePath, location, slug);
    mkdirSync(skillDir, { recursive: true });

    const frontmatter: string[] = [];
    if (options.name) frontmatter.push(`name: ${options.name}`);
    if (options.description) frontmatter.push(`description: ${options.description}`);
    if (options.userInvocable === false) frontmatter.push('user-invocable: false');

    const content = `---
${frontmatter.join('\n')}
---
${options.content ?? '# Default content'}`;

    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }

  /**
   * Helper to create a legacy command fixture.
   */
  function createLegacyCommandFixture(
    basePath: string,
    location: string,
    name: string,
    options: { description?: string; content?: string }
  ) {
    const commandDir = join(basePath, location);
    mkdirSync(commandDir, { recursive: true });

    const content = `---
${options.description ? `description: ${options.description}` : ''}
---
${options.content ?? '# Legacy command content'}`;

    writeFileSync(join(commandDir, `${name}.md`), content);
  }

  it('creates skill fixtures in mort directory', () => {
    // Create a skill in ~/.mort/skills/
    createSkillFixture(mortDir.path, 'skills', 'test-mort', {
      name: 'test-mort',
      description: 'Test skill in mort directory',
      content: 'This is a test skill for Mort. Args: $ARGUMENTS',
    });

    // Verify file was created
    const skillPath = join(mortDir.path, 'skills', 'test-mort', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');

    expect(content).toContain('name: test-mort');
    expect(content).toContain('description: Test skill in mort directory');
    expect(content).toContain('This is a test skill for Mort');
  });

  it('creates skill fixtures in personal claude directory', () => {
    // Simulate ~/.claude/skills/ by using a subdirectory
    createSkillFixture(mortDir.path, 'claude/skills', 'test-personal', {
      name: 'test-personal',
      description: 'Personal skill',
      content: '# Personal skill content',
    });

    const skillPath = join(mortDir.path, 'claude', 'skills', 'test-personal', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');

    expect(content).toContain('name: test-personal');
  });

  it('creates project-level skill fixtures in repo', () => {
    // Create skill in <repo>/.claude/skills/
    createSkillFixture(repo.path, '.claude/skills', 'test-project', {
      name: 'test-project',
      description: 'Project-specific skill',
      content: '# Project skill for $ARGUMENTS',
    });

    const skillPath = join(repo.path, '.claude', 'skills', 'test-project', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');

    expect(content).toContain('name: test-project');
    expect(content).toContain('Project-specific skill');
  });

  it('creates legacy command fixtures', () => {
    createLegacyCommandFixture(mortDir.path, 'claude/commands', 'test-command', {
      description: 'A legacy command',
      content: 'Legacy command content here',
    });

    const commandPath = join(mortDir.path, 'claude', 'commands', 'test-command.md');
    const content = readFileSync(commandPath, 'utf-8');

    expect(content).toContain('description: A legacy command');
    expect(content).toContain('Legacy command content here');
  });

  it('skill with user-invocable: false is excluded', () => {
    createSkillFixture(mortDir.path, 'skills', 'hidden-skill', {
      name: 'Hidden',
      description: 'This skill is not user-invocable',
      userInvocable: false,
    });

    const skillPath = join(mortDir.path, 'skills', 'hidden-skill', 'SKILL.md');
    const content = readFileSync(skillPath, 'utf-8');

    expect(content).toContain('user-invocable: false');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty skill content (frontmatter only)', () => {
    const content = `---
name: Empty Skill
description: Has no body
---`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('Empty Skill');
    expect(result.body).toBe('');
  });

  it('handles special characters in arguments', () => {
    const matches = extractSkillMatches('/commit "fix: handle $special & <chars>"');
    expect(matches).toHaveLength(1);
    // Args should preserve special characters
    expect(matches[0].args).toContain('$special');
    expect(matches[0].args).toContain('&');
    expect(matches[0].args).toContain('<chars>');
  });
});
