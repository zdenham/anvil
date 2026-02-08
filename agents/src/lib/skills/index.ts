// Re-export types from core for convenience
export type {
  SkillSource,
  SkillContent,
  SkillMatch,
  SkillInjection,
} from "@core/types/skills.js";

// Export skill processing functions
export { extractSkillMatches, buildSkillInstruction, processMessageWithSkills } from "./inject-skill.js";

// Export the service instance for agent use
export { skillsService } from "../skills-service-instance.js";
