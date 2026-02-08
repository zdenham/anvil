// Re-export types from core for convenience
export type {
  SkillSource,
  SkillContent,
  SkillMatch,
  SkillInjection,
} from "@core/types/skills.js";

// Export the service instance for agent use
export { skillsService } from "../skills-service-instance.js";
