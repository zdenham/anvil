// Re-export types from canonical location
export type {
  SkillFrontmatter,
  SkillSource,
  SkillMetadata,
  SkillReference,
  SkillContent,
  SkillMatch,
  SkillInjection,
} from '@core/types/skills.js';

// Constants
export {
  SOURCE_PRIORITY,
  SOURCE_ICONS,
  SOURCE_LABELS,
  SOURCE_BADGE_STYLES,
} from './constants.js';

// Patterns
export { SKILL_PATTERN, SKILL_PATTERN_COMPAT } from './patterns.js';

// Utilities
export { parseFrontmatter, stripFrontmatter } from './parse-frontmatter.js';
export type { ParsedFrontmatter } from './parse-frontmatter.js';
export { extractSkillMatches } from './extract-matches.js';
export { scoreMatch } from './score-match.js';
