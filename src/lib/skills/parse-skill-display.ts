import { extractSkillMatches } from "@core/skills";
import type { SkillMatch } from "@core/skills";

// Re-export for convenience
export type { SkillMatch };

export interface ParsedSkillMessage {
  skills: SkillMatch[];
  remainingText: string;
}

/**
 * Parse skills from a display message for UI rendering.
 *
 * Uses `extractSkillMatches` from @core/skills (shared with agent injection)
 * to ensure consistent parsing across frontend and backend.
 */
export function parseSkillsFromDisplayMessage(message: string): ParsedSkillMessage {
  const skills = extractSkillMatches(message);

  // Remove skill invocations from message to get remaining text
  let remainingText = message;
  for (const skill of skills) {
    remainingText = remainingText.replace(skill.fullMatch, "").trim();
  }

  return { skills, remainingText };
}
