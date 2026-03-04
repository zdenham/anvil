import { cn } from "@/lib/utils";
import type { SkillMetadata } from "@/entities/skills";
import { SOURCE_BADGE_STYLES } from "@core/skills";

interface SkillListItemProps {
  skill: SkillMetadata;
}

/**
 * Displays a single skill in the settings list.
 * Uses SOURCE_BADGE_STYLES from @core/skills for consistent badge styling.
 */
export function SkillListItem({ skill }: SkillListItemProps) {
  const badge = SOURCE_BADGE_STYLES[skill.source];

  return (
    <div data-testid={`skill-item-${skill.slug}`} className="flex flex-col gap-1 py-3 border-b border-surface-700 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium text-surface-100">/{skill.slug}</span>
        <span className={cn(
          "text-xs px-1.5 py-0.5 rounded",
          badge.className
        )}>
          {badge.label}
        </span>
        {skill.isLegacyCommand && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-700 text-surface-400">
            Legacy
          </span>
        )}
      </div>

      {skill.description && (
        <p className="text-sm text-surface-400">
          {skill.description}
        </p>
      )}

      <span className="text-xs text-surface-500 font-mono truncate">
        {skill.path}
      </span>
    </div>
  );
}
