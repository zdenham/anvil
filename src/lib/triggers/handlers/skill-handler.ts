import type {
  TriggerHandler,
  TriggerConfig,
  TriggerContext,
  TriggerResult,
} from "../types";
import { skillsService } from "@/entities/skills";
import { SOURCE_ICONS, SOURCE_LABELS } from "@core/skills";
import { getHomeDir } from "@/lib/utils/path-display";
import { getAnvilDir } from "@/lib/paths";

/**
 * Skill trigger handler for "/" - follows same pattern as FileTriggerHandler for "@"
 *
 * Uses shared constants from @core/skills for icons and labels to ensure
 * consistency across the UI (dropdown, chips, settings).
 */
class SkillTriggerHandler implements TriggerHandler {
  readonly config: TriggerConfig = {
    char: "/",
    name: "Skill",
    placeholder: "Search skills and commands...",
    minQueryLength: 0,
  };

  async search(
    query: string,
    context: TriggerContext,
    _signal?: AbortSignal
  ): Promise<TriggerResult[]> {
    if (!context.rootPath) {
      return [];
    }

    // Refresh skills on each "/" trigger (ensures fresh list)
    const homeDir = getHomeDir();
    if (homeDir) {
      const anvilDir = await getAnvilDir();
      await skillsService.discover(context.rootPath, homeDir, anvilDir);
    }

    const skills = query
      ? skillsService.search(query)
      : skillsService.getAll();

    return skills.map((skill) => ({
      id: skill.slug,
      label: skill.source === 'anvil' ? `/anvil:${skill.slug}` : `/${skill.slug}`,
      description: skill.description || "",
      icon: SOURCE_ICONS[skill.source], // Lucide icon name from shared constants
      insertText: skill.source === 'anvil' ? `/anvil:${skill.slug} ` : `/${skill.slug} `,
      secondaryLabel: SOURCE_LABELS[skill.source], // Display label from shared constants
    }));
  }
}

export const skillTriggerHandler = new SkillTriggerHandler();
