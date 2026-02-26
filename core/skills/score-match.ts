import type { SkillMetadata } from '@core/types/skills.js';

/**
 * Score how well a skill matches a search query.
 * Lower score = better match. Infinity = no match.
 *
 * 0 = exact name/slug match
 * 1 = name/slug starts with query
 * 2 = name/slug contains query
 * 3 = description contains query
 */
export function scoreMatch(skill: SkillMetadata, query: string): number {
  const name = skill.name.toLowerCase();
  const slug = skill.slug.toLowerCase();
  const desc = skill.description.toLowerCase();

  if (name === query || slug === query) return 0;
  if (name.startsWith(query) || slug.startsWith(query)) return 1;
  if (name.includes(query) || slug.includes(query)) return 2;
  if (desc.includes(query)) return 3;

  return Infinity;
}
