import { describe, it, expect } from 'vitest';
import { scoreMatch } from '@core/skills/score-match.js';
import type { SkillMetadata } from '@core/types/skills.js';

function makeSkill(overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return {
    id: 'test-id',
    slug: overrides.slug ?? 'commit',
    name: overrides.name ?? 'commit',
    description: overrides.description ?? 'Create a git commit',
    source: 'project',
    path: '/fake/path',
    isLegacyCommand: false,
    userInvocable: true,
    disableModelInvocation: false,
    ...overrides,
  };
}

describe('scoreMatch', () => {
  it('returns 0 for exact name match', () => {
    expect(scoreMatch(makeSkill({ name: 'commit' }), 'commit')).toBe(0);
  });

  it('returns 0 for exact slug match', () => {
    expect(scoreMatch(makeSkill({ slug: 'commit', name: 'Commit Changes' }), 'commit')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(scoreMatch(makeSkill({ name: 'Commit' }), 'commit')).toBe(0);
  });

  it('returns 1 for prefix match on name', () => {
    expect(scoreMatch(makeSkill({ name: 'commit-all', slug: 'commit-all' }), 'commit')).toBe(1);
  });

  it('returns 1 for prefix match on slug', () => {
    expect(scoreMatch(makeSkill({ slug: 'commit-all', name: 'Commit All' }), 'commit')).toBe(1);
  });

  it('returns 2 for substring match in name', () => {
    expect(scoreMatch(makeSkill({ name: 'auto-commit', slug: 'auto-commit' }), 'commit')).toBe(2);
  });

  it('returns 3 for match in description only', () => {
    expect(scoreMatch(makeSkill({
      name: 'save',
      slug: 'save',
      description: 'commit changes to disk',
    }), 'commit')).toBe(3);
  });

  it('returns Infinity for no match', () => {
    expect(scoreMatch(makeSkill({ name: 'deploy', slug: 'deploy', description: 'Deploy app' }), 'commit')).toBe(Infinity);
  });

  it('ranks exact > prefix > substring > description', () => {
    const exact = makeSkill({ name: 'commit', slug: 'commit', description: '' });
    const prefix = makeSkill({ name: 'commit-all', slug: 'commit-all', description: '' });
    const substring = makeSkill({ name: 'auto-commit', slug: 'auto-commit', description: '' });
    const descOnly = makeSkill({ name: 'save', slug: 'save', description: 'commit to disk' });

    const scores = [exact, prefix, substring, descOnly].map(s => scoreMatch(s, 'commit'));
    expect(scores).toEqual([0, 1, 2, 3]);

    // Sorted order should be maintained
    const sorted = [...scores].sort((a, b) => a - b);
    expect(sorted).toEqual(scores);
  });
});
