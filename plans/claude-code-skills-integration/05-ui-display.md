# 05: UI Display

## Overview

Render skill invocations as expandable chips in user messages. Supports multiple skills per message with lazy-loaded content and stale skill detection.

## Phases

- [ ] Create skill display parser (shares logic with agent)
- [ ] Create SkillChip component
- [ ] Update UserMessage to render skill chips
- [ ] Handle stale skills gracefully

---

## Dependencies

- **01-types-foundation** - Needs `extractSkillMatches`, `SOURCE_ICONS` from shared utilities
- **03-skills-service** - Needs `skillsService.readContent()`

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/skills/parse-skill-display.ts` | **CREATE** |
| `src/components/thread/skill-chip.tsx` | **CREATE** |
| `src/components/thread/user-message.tsx` | **MODIFY** - Render skill chips |

---

## Implementation

### 1. Skill Display Parser

Create `src/lib/skills/parse-skill-display.ts`:

```typescript
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
```

### 2. Skill Chip Component

Create `src/components/thread/skill-chip.tsx`:

```tsx
import { useState } from "react";
import { ChevronRight, ChevronDown, AlertCircle } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/utils";
import { skillsService, useSkillsStore } from "@/entities/skills";
import { SOURCE_ICONS } from "@core/skills";

interface SkillChipProps {
  slug: string;
  args: string;
}

/**
 * Dynamically render a Lucide icon by name.
 * Falls back to Zap icon if the icon name is not found.
 */
function SourceIcon({ name, className }: { name: string; className?: string }) {
  // Convert kebab-case to PascalCase for Lucide component lookup
  const pascalName = name
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  const IconComponent = (LucideIcons as Record<string, React.ComponentType<{ className?: string }>>)[pascalName]
    || LucideIcons.Zap;

  return <IconComponent className={className} />;
}

export function SkillChip({ slug, args }: SkillChipProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [loading, setLoading] = useState(false);

  const skill = useSkillsStore(state => state.getBySlug(slug));
  const source = skill?.source;
  // Use Lucide icon name from shared constants
  const iconName = source ? SOURCE_ICONS[source] : "zap";

  const handleExpand = async () => {
    if (!expanded && content === null && !isStale) {
      setLoading(true);
      try {
        const skillContent = await skillsService.readContent(slug);
        if (skillContent) {
          setContent(skillContent.content);
        } else {
          setIsStale(true);
        }
      } catch {
        setIsStale(true);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div className={cn(
      "skill-chip rounded-md border mb-2",
      isStale && "border-yellow-500/50 bg-yellow-500/5"
    )}>
      <button
        onClick={handleExpand}
        className="flex items-center gap-2 px-3 py-1.5 w-full text-left hover:bg-muted/50 rounded-md transition-colors"
      >
        <SourceIcon name={iconName} className="w-4 h-4" />
        <span className="font-mono text-sm font-medium">/{slug}</span>
        {args && (
          <span className="text-muted-foreground text-sm truncate max-w-[200px]">
            {args}
          </span>
        )}
        {isStale && (
          <span className="flex items-center gap-1 text-yellow-600 text-xs ml-auto">
            <AlertCircle className="w-3 h-3" />
            stale
          </span>
        )}
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading...</div>
          ) : isStale ? (
            <div className="text-yellow-600 text-sm">
              This skill is no longer available. The file may have been moved or deleted.
            </div>
          ) : (
            <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/30 p-2 rounded overflow-x-auto">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
```

### 3. Update User Message

Update `src/components/thread/user-message.tsx`:

**Note:** The actual component uses `Turn` from `turn-grouping.ts`, not `ThreadMessage`. The `getUserTurnPrompt(turn)` utility extracts user text content from turns, handling both string content and array content (with `text` and `tool_result` blocks).

```tsx
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/utils/turn-grouping";
import { getUserTurnPrompt } from "@/lib/utils/turn-grouping";
import { parseSkillsFromDisplayMessage } from "@/lib/skills/parse-skill-display";
import { SkillChip } from "./skill-chip";

interface UserMessageProps {
  /** The user turn containing the message */
  turn: Turn;
}

/**
 * Right-aligned user message bubble.
 */
export function UserMessage({ turn }: UserMessageProps) {
  // getUserTurnPrompt handles both string content and array content
  // (with text blocks and tool_result blocks) - returns just the text portion
  const content = getUserTurnPrompt(turn);

  // Don't render empty user messages (e.g., tool-result-only turns)
  if (!content) {
    return null;
  }

  // Parse skill invocations from the text content
  const { skills, remainingText } = parseSkillsFromDisplayMessage(content);

  return (
    <article
      role="article"
      aria-label="Your message"
      className="flex justify-end my-3"
    >
      <div
        className={cn(
          "max-w-[80%] px-4 py-3 rounded-2xl",
          "bg-accent-600 text-accent-900",
          "shadow-sm"
        )}
      >
        {/* Render skill chips first */}
        {skills.length > 0 && (
          <div className="skill-chips mb-2">
            {skills.map((skill, idx) => (
              <SkillChip
                key={`${skill.skillSlug}-${idx}`}
                slug={skill.skillSlug}
                args={skill.args}
              />
            ))}
          </div>
        )}

        {/* Render remaining text */}
        {remainingText && (
          <p className="whitespace-pre-wrap break-words">{remainingText}</p>
        )}
      </div>
    </article>
  );
}
```

---

## Acceptance Criteria

- [ ] Skill invocations render as chips above message text
- [ ] Multiple skills render as multiple chips
- [ ] Click expands chip to show skill content
- [ ] Content lazy-loaded on first expand
- [ ] Stale skills show warning indicator
- [ ] Stale skills show helpful message when expanded
- [ ] Source icon shows for each skill type
- [ ] Args displayed in chip (truncated if long)
