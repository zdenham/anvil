# 04: Slash Command Trigger

## Overview

Implement the `/` trigger handler for the skill dropdown. Uses the existing trigger system (same pattern as `@` file mentions).

## Phases

- [x] Create skill trigger handler
- [x] Register handler in trigger registry
- [x] Update input placeholder text
- [x] Add secondaryLabel support to dropdown (if needed)

---

## Dependencies

- **01-types-foundation** - Needs `SOURCE_ICONS`, `SOURCE_LABELS` from shared utilities
- **03-skills-service** - Needs `skillsService.discover()` and `skillsService.search()`

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/triggers/handlers/skill-handler.ts` | **CREATE** |
| `src/lib/triggers/index.ts` | **MODIFY** - Register skill handler |
| `src/components/reusable/thread-input.tsx` | **MODIFY** - Update placeholder |
| `src/components/reusable/trigger-dropdown.tsx` | **MODIFY** - Add secondaryLabel display (if not present) |

---

## Implementation

### 1. Skill Trigger Handler

Create `src/lib/triggers/handlers/skill-handler.ts`:

```typescript
import type { TriggerConfig, TriggerHandler, TriggerResult, TriggerContext } from "../types";
import { skillsService } from "@/entities/skills";
import { SOURCE_ICONS, SOURCE_LABELS } from "@core/skills";

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
    await skillsService.discover(context.rootPath);

    const skills = query
      ? skillsService.search(query)
      : skillsService.getAll();

    return skills.map(skill => ({
      id: skill.id,
      label: `/${skill.slug}`,
      description: skill.description || "",
      icon: SOURCE_ICONS[skill.source],         // Lucide icon name from shared constants
      insertText: `/${skill.slug} `,
      secondaryLabel: SOURCE_LABELS[skill.source], // Display label from shared constants
    }));
  }
}

export const skillTriggerHandler = new SkillTriggerHandler();
```

### 2. Register Handler

Update `src/lib/triggers/index.ts`:

```typescript
import { triggerRegistry } from "./registry";
import { FileTriggerHandler } from "./handlers/file-handler";
import { skillTriggerHandler } from "./handlers/skill-handler";

let initialized = false;

export function initializeTriggers(): void {
  if (initialized) return;
  initialized = true;

  triggerRegistry.register(new FileTriggerHandler());
  triggerRegistry.register(skillTriggerHandler);  // ADD THIS
}
```

### 3. Update Input Placeholder

Update `src/components/reusable/thread-input.tsx`:

Change placeholder text to:
```
"Type a message, @ to mention files, / for skills..."
```

### 4. Dropdown Secondary Label

If `TriggerDropdown` doesn't already support `secondaryLabel`, add it:

```tsx
// In trigger-dropdown.tsx
{result.secondaryLabel && (
  <span className="trigger-result-secondary text-muted-foreground text-xs">
    {result.secondaryLabel}
  </span>
)}
```

---

## Behavior Notes

The existing trigger system handles:
- Word-boundary detection (only triggers when `/` is at start or after whitespace)
- Escape sequence `//` for literal `/`
- Debounced search (150ms)
- Keyboard navigation (arrow keys, Enter, Tab, Escape)
- Prevention of false positives in URLs and file paths

No need to duplicate this logic.

---

## Acceptance Criteria

- [x] `/` at start of input opens skill dropdown
- [x] `/` after space in message opens skill dropdown
- [x] `//` inserts literal `/` (escape sequence)
- [x] `/` in URLs (e.g., `http://`) does NOT trigger dropdown
- [x] Skills searchable by name and description
- [x] Source label shown (Personal, Project, Anvil)
- [x] Selecting skill inserts `/<slug> ` with trailing space
- [x] Dropdown refreshes skill list on each trigger
