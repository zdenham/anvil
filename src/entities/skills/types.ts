/**
 * Re-export canonical types from core for frontend use.
 * This maintains proper dependency direction: src -> core
 */
export type {
  SkillSource,
  SkillMetadata,
  SkillReference,
  SkillContent,
  SkillFrontmatter,
  SkillMatch,
  SkillInjection,
} from '@core/types/skills.js';
