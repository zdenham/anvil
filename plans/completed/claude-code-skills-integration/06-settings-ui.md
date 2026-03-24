# 06: Settings UI

## Overview

Add a Skills section to the settings panel showing all discovered skills with their sources, descriptions, and paths.

## Phases

- [x] Create SkillListItem component
- [x] Create SkillsSettings section
- [x] Add to settings routes

---

## Dependencies

- **01-types-foundation** - Needs `SOURCE_BADGE_STYLES` from shared utilities
- **03-skills-service** - Needs `skillsService.getAll()`

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/main-window/settings/skill-list-item.tsx` | **CREATE** |
| `src/components/main-window/settings/skills-settings.tsx` | **CREATE** |
| `src/components/main-window/settings-page.tsx` | **MODIFY** - Add Skills section |

---

## Implementation

### 1. Skill List Item

Create `src/components/settings/skill-list-item.tsx`:

```tsx
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
    <div className="flex flex-col gap-1 py-3 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium">/{skill.slug}</span>
        <span className={cn(
          "text-xs px-1.5 py-0.5 rounded",
          badge.className
        )}>
          {badge.label}
        </span>
        {skill.isLegacyCommand && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            Legacy
          </span>
        )}
      </div>

      {skill.description && (
        <p className="text-sm text-muted-foreground">
          {skill.description}
        </p>
      )}

      <span className="text-xs text-muted-foreground/70 font-mono truncate">
        {skill.path}
      </span>
    </div>
  );
}
```

### 2. Skills Settings Section

Create `src/components/settings/skills-settings.tsx`:

```tsx
import { useEffect } from "react";
import { useSkillsStore, skillsService } from "@/entities/skills";
import { useWorktreeStore } from "@/entities/worktrees";
import { SkillListItem } from "./skill-list-item";
import { SettingsSection } from "./settings-section";
import { FolderOpen, ExternalLink } from "lucide-react";

export function SkillsSettings() {
  const skills = useSkillsStore(state => state.getAll());
  const activeWorktree = useWorktreeStore(state => state.active);

  // Refresh skills when settings opens
  useEffect(() => {
    if (activeWorktree?.path) {
      skillsService.discover(activeWorktree.path);
    }
  }, [activeWorktree?.path]);

  const projectSkills = skills.filter(s =>
    s.source === 'project' || s.source === 'project_command'
  );
  const personalSkills = skills.filter(s =>
    s.source === 'personal' || s.source === 'personal_command' || s.source === 'anvil'
  );

  return (
    <SettingsSection
      title="Skills"
      description="Skills extend agent capabilities. Use /skill-name to invoke."
    >
      <div className="space-y-6">
        {/* Help text */}
        <div className="text-sm text-muted-foreground space-y-2">
          <p>Create skills in these locations:</p>
          <ul className="list-disc list-inside space-y-1 text-xs font-mono">
            <li>~/.anvil/skills/&lt;name&gt;/SKILL.md (Anvil-specific)</li>
            <li>~/.claude/skills/&lt;name&gt;/SKILL.md (Personal)</li>
            <li>&lt;repo&gt;/.claude/skills/&lt;name&gt;/SKILL.md (Project)</li>
            <li>~/.claude/commands/&lt;name&gt;.md (Legacy)</li>
          </ul>
        </div>

        {/* Skills list */}
        {skills.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No skills found</p>
            <p className="text-xs mt-1">
              Create a SKILL.md file in one of the locations above
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {projectSkills.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Project Skills ({projectSkills.length})
                </h4>
                <div className="border rounded-md px-3">
                  {projectSkills.map(skill => (
                    <SkillListItem key={skill.id} skill={skill} />
                  ))}
                </div>
              </div>
            )}

            {personalSkills.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Personal Skills ({personalSkills.length})
                </h4>
                <div className="border rounded-md px-3">
                  {personalSkills.map(skill => (
                    <SkillListItem key={skill.id} skill={skill} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Link to docs */}
        <a
          href="https://docs.anthropic.com/en/docs/claude-code/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Learn more about skills
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </SettingsSection>
  );
}
```

### 3. Add to Settings Routes

Update `src/components/settings/index.tsx` to include the Skills section:

```tsx
import { SkillsSettings } from "./skills-settings";

// In the settings navigation/tabs:
// Add "Skills" as a new section

// In the settings content:
<SkillsSettings />
```

---

## Acceptance Criteria

- [x] Skills section visible in settings
- [x] Skills grouped by source (Project vs Personal)
- [x] Each skill shows: slug, source badge, description, path
- [x] Legacy commands marked with "Legacy" badge
- [x] Empty state shows when no skills found
- [x] Help text explains skill locations
- [x] Link to documentation works
- [x] Skills refresh when settings opens
