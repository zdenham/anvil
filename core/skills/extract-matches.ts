import { SKILL_PATTERN } from './patterns.js';
import type { SkillMatch } from '@core/types/skills.js';

/**
 * Extract all skill invocations from a message.
 *
 * @param message - User message text
 * @returns Array of skill matches with slugs, args, and full match text
 *
 * @example
 * extractSkillMatches("/commit fix bug")
 * // => [{ skillSlug: "commit", args: "fix bug", fullMatch: "/commit fix bug" }]
 *
 * extractSkillMatches("Please /review-pr 123 and /deploy")
 * // => [
 * //   { skillSlug: "review-pr", args: "123", fullMatch: "/review-pr 123" },
 * //   { skillSlug: "deploy", args: "", fullMatch: "/deploy" }
 * // ]
 */
export function extractSkillMatches(message: string): SkillMatch[] {
  const matches: SkillMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state (important for global regex)
  SKILL_PATTERN.lastIndex = 0;

  while ((match = SKILL_PATTERN.exec(message)) !== null) {
    matches.push({
      skillSlug: match[1].toLowerCase(),
      args: (match[2] || '').trim(),
      fullMatch: match[0],
    });
  }

  return matches;
}
