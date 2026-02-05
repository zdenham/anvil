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
export interface SkillMatch {
  skillSlug: string;
  args: string;
  fullMatch: string;
}

export interface ParsedSkillMessage {
  skills: SkillMatch[];
  remainingText: string;
}

// Matches /skill-name or /skill-name args
// Only at word boundary (start, after whitespace, after newline)
const SKILL_PATTERN = /(?:^|(?<=\s))\/([a-z0-9_-]+)(?:\s+([^\n]*))?/gim;

/**
 * Extract all skill invocations from a message.
 */
export function extractSkillMatches(message: string): SkillMatch[] {
  const matches: SkillMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  SKILL_PATTERN.lastIndex = 0;

  while ((match = SKILL_PATTERN.exec(message)) !== null) {
    matches.push({
      skillSlug: match[1].toLowerCase(),
      args: (match[2] || "").trim(),
      fullMatch: match[0],
    });
  }

  return matches;
}

/**
 * Parse skills from a display message for UI rendering.
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
import { cn } from "@/lib/utils";
import { skillsService, useSkillsStore } from "@/entities/skills";
import type { SkillSource } from "@/entities/skills";

interface SkillChipProps {
  slug: string;
  args: string;
}

const SOURCE_ICONS: Record<SkillSource, string> = {
  mort: "✨",
  personal: "👤",
  project: "📁",
  personal_command: "💻",
  project_command: "📂",
};

export function SkillChip({ slug, args }: SkillChipProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [loading, setLoading] = useState(false);

  const skill = useSkillsStore(state => state.getBySlug(slug));
  const source = skill?.source;
  const sourceIcon = source ? SOURCE_ICONS[source] : "⚡";

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
        <span className="text-sm">{sourceIcon}</span>
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

```tsx
import { parseSkillsFromDisplayMessage } from "@/lib/skills/parse-skill-display";
import { SkillChip } from "./skill-chip";

function UserMessage({ message }: { message: ThreadMessage }) {
  const { skills, remainingText } = parseSkillsFromDisplayMessage(message.content);

  return (
    <div className="user-message">
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
        <div className="message-content">
          {/* existing content rendering */}
          {remainingText}
        </div>
      )}
    </div>
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
