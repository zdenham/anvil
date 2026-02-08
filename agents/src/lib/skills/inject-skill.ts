import type { SkillSource, SkillContent, SkillInjection } from "@core/types/skills.js";
import { extractSkillMatches } from "@core/skills/index.js";

// Re-export extractSkillMatches for convenience
export { extractSkillMatches };

/**
 * Build system prompt content for a single skill.
 */
export function buildSkillInstruction(
  skillSlug: string,
  source: SkillSource,
  content: string,
  args: string
): string {
  // Substitute $ARGUMENTS in skill content
  const processedContent = content.replace(/\$ARGUMENTS/g, args);

  return `<skill-instruction>
The user has invoked a skill. You MUST follow the instructions in the <skill> block below. This skill was loaded from outside your standard skill directories and was explicitly requested by the user.

<skill name="${skillSlug}" source="${source}">
${processedContent}
</skill>
</skill-instruction>`;
}

/**
 * Process a message and build skill injections.
 * Called by the agent runner, not the frontend.
 */
export async function processMessageWithSkills(
  message: string,
  readSkillContent: (slug: string) => Promise<SkillContent | null>
): Promise<SkillInjection> {
  const skillMatches = extractSkillMatches(message);

  if (skillMatches.length === 0) {
    return {
      displayMessage: message,
      userMessage: message,
      systemPromptAppend: null,
      skills: [],
    };
  }

  const skillInstructions: string[] = [];
  const foundSkills: Array<{ slug: string; source: SkillSource }> = [];

  for (const match of skillMatches) {
    const skillContent = await readSkillContent(match.skillSlug);

    if (!skillContent) {
      // Skill not found, skip it
      continue;
    }

    foundSkills.push({ slug: match.skillSlug, source: skillContent.source });

    const instruction = buildSkillInstruction(
      match.skillSlug,
      skillContent.source,
      skillContent.content,
      match.args
    );

    skillInstructions.push(instruction);
  }

  return {
    displayMessage: message,
    userMessage: message,
    systemPromptAppend: skillInstructions.length > 0
      ? skillInstructions.join("\n\n")
      : null,
    skills: foundSkills,
  };
}
