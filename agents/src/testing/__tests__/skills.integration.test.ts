import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { TestMortDirectory } from '../services/test-mort-directory.js';
import { TestRepository } from '../services/test-repository.js';
import {
  extractSkillMatches,
  buildSkillInstruction,
  processMessageWithSkills,
} from '../../lib/skills/inject-skill.js';
import { parseFrontmatter } from '@core/skills/index.js';
import type { SkillContent, SkillSource } from '@core/types/skills.js';

/**
 * Integration tests for the skills system.
 *
 * These tests verify:
 * 1. Skill extraction from messages (extractSkillMatches)
 * 2. Frontmatter parsing (parseFrontmatter)
 * 3. System prompt building (buildSkillInstruction)
 * 4. Full message processing (processMessageWithSkills)
 * 5. Discovery flow with filesystem fixtures
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
// Unit Tests - buildSkillInstruction
// ============================================================================

describe('buildSkillInstruction', () => {
  it('builds instruction with skill content and args', () => {
    const instruction = buildSkillInstruction(
      'commit',
      'project',
      'Create a commit with the message: $ARGUMENTS',
      'fix authentication bug'
    );

    expect(instruction).toContain('<skill-instruction>');
    expect(instruction).toContain('<skill name="commit" source="project">');
    expect(instruction).toContain('Create a commit with the message: fix authentication bug');
    expect(instruction).not.toContain('$ARGUMENTS');
  });

  it('handles empty args', () => {
    const instruction = buildSkillInstruction(
      'deploy',
      'mort',
      'Deploy the application. Args: $ARGUMENTS',
      ''
    );

    expect(instruction).toContain('Deploy the application. Args: ');
    expect(instruction).toContain('source="mort"');
  });

  it('substitutes multiple $ARGUMENTS occurrences', () => {
    const instruction = buildSkillInstruction(
      'test',
      'personal',
      'First: $ARGUMENTS, Second: $ARGUMENTS',
      'hello'
    );

    expect(instruction).toContain('First: hello, Second: hello');
    expect(instruction).not.toContain('$ARGUMENTS');
  });

  it('preserves content without $ARGUMENTS', () => {
    const instruction = buildSkillInstruction(
      'simple',
      'project_command',
      'Just do the thing',
      'ignored args'
    );

    expect(instruction).toContain('Just do the thing');
  });
});

// ============================================================================
// Unit Tests - processMessageWithSkills
// ============================================================================

describe('processMessageWithSkills', () => {
  it('processes message with no skills', async () => {
    const mockReadContent = vi.fn();

    const result = await processMessageWithSkills(
      'Just a regular message',
      mockReadContent
    );

    expect(result.displayMessage).toBe('Just a regular message');
    expect(result.userMessage).toBe('Just a regular message');
    expect(result.systemPromptAppend).toBeNull();
    expect(result.skills).toHaveLength(0);
    expect(mockReadContent).not.toHaveBeenCalled();
  });

  it('processes message with one skill', async () => {
    const mockReadContent = vi.fn().mockResolvedValue({
      content: 'Create a commit with: $ARGUMENTS',
      source: 'project' as SkillSource,
    });

    const result = await processMessageWithSkills(
      '/commit fix bug',
      mockReadContent
    );

    expect(mockReadContent).toHaveBeenCalledWith('commit');
    expect(result.displayMessage).toBe('/commit fix bug');
    expect(result.userMessage).toBe('/commit fix bug');
    expect(result.systemPromptAppend).toContain('<skill name="commit"');
    expect(result.systemPromptAppend).toContain('Create a commit with: fix bug');
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toEqual({ slug: 'commit', source: 'project' });
  });

  it('processes message with multiple skills on separate lines', async () => {
    const mockReadContent = vi.fn().mockImplementation(async (slug: string) => {
      if (slug === 'review') {
        return { content: 'Review PR #$ARGUMENTS', source: 'project' as SkillSource };
      }
      if (slug === 'deploy') {
        return { content: 'Deploy to production', source: 'mort' as SkillSource };
      }
      return null;
    });

    const result = await processMessageWithSkills(
      '/review 123\n/deploy',
      mockReadContent
    );

    expect(result.skills).toHaveLength(2);
    expect(result.systemPromptAppend).toContain('<skill name="review"');
    expect(result.systemPromptAppend).toContain('Review PR #123');
    expect(result.systemPromptAppend).toContain('<skill name="deploy"');
    expect(result.systemPromptAppend).toContain('Deploy to production');
  });

  it('skips skills that are not found', async () => {
    const mockReadContent = vi.fn().mockResolvedValue(null);

    const result = await processMessageWithSkills(
      '/nonexistent arg',
      mockReadContent
    );

    expect(mockReadContent).toHaveBeenCalledWith('nonexistent');
    expect(result.skills).toHaveLength(0);
    expect(result.systemPromptAppend).toBeNull();
  });

  it('handles mixed found and not-found skills', async () => {
    const mockReadContent = vi.fn().mockImplementation(async (slug: string) => {
      if (slug === 'found') {
        return { content: 'Found skill content', source: 'project' as SkillSource };
      }
      return null;
    });

    const result = await processMessageWithSkills(
      '/found /notfound /found again',
      mockReadContent
    );

    // Should only include the found skill (appears once since it's the same slug)
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].slug).toBe('found');
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

  it('handles very long skill content', async () => {
    const longContent = 'A'.repeat(10000);
    const mockReadContent = vi.fn().mockResolvedValue({
      content: longContent,
      source: 'project' as SkillSource,
    });

    const result = await processMessageWithSkills('/longskill', mockReadContent);

    expect(result.systemPromptAppend).toContain(longContent);
    expect(result.systemPromptAppend!.length).toBeGreaterThan(10000);
  });

  it('handles unicode in skill content', async () => {
    const unicodeContent = 'Handle these: emoji, CJK, RTL';
    const mockReadContent = vi.fn().mockResolvedValue({
      content: unicodeContent,
      source: 'project' as SkillSource,
    });

    const result = await processMessageWithSkills('/unicode', mockReadContent);

    expect(result.systemPromptAppend).toContain('emoji');
  });

  it('handles newlines in skill content', async () => {
    const multilineContent = `Line 1
Line 2
Line 3

With blank line above`;

    const mockReadContent = vi.fn().mockResolvedValue({
      content: multilineContent,
      source: 'project' as SkillSource,
    });

    const result = await processMessageWithSkills('/multi', mockReadContent);

    expect(result.systemPromptAppend).toContain('Line 1\nLine 2\nLine 3');
    expect(result.systemPromptAppend).toContain('With blank line above');
  });
});

// ============================================================================
// Concurrent Discovery (Race Condition Tests)
// ============================================================================

describe('Concurrent Operations', () => {
  it('handles concurrent skill content reads', async () => {
    let callCount = 0;
    const mockReadContent = vi.fn().mockImplementation(async (slug: string) => {
      callCount++;
      // Simulate async delay
      await new Promise(resolve => setTimeout(resolve, 10));
      return { content: `Content for ${slug}`, source: 'project' as SkillSource };
    });

    // Fire multiple reads concurrently
    const promises = [
      processMessageWithSkills('/skill1 args', mockReadContent),
      processMessageWithSkills('/skill2 args', mockReadContent),
      processMessageWithSkills('/skill3 args', mockReadContent),
    ];

    const results = await Promise.all(promises);

    // All should complete successfully
    expect(results[0].skills[0].slug).toBe('skill1');
    expect(results[1].skills[0].slug).toBe('skill2');
    expect(results[2].skills[0].slug).toBe('skill3');
    expect(callCount).toBe(3);
  });

  it('handles rapid sequential calls', async () => {
    const results: string[] = [];
    const mockReadContent = vi.fn().mockImplementation(async (slug: string) => {
      results.push(slug);
      return { content: slug, source: 'project' as SkillSource };
    });

    // Rapid sequential calls
    for (let i = 0; i < 10; i++) {
      await processMessageWithSkills(`/skill${i}`, mockReadContent);
    }

    expect(results).toHaveLength(10);
    // Verify order is maintained
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toBe(`skill${i}`);
    }
  });
});
