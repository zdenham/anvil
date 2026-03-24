# Fix Skill Loading: Use `anvil:` Namespace Prefix Everywhere

**Problem**: When skills spawn child agents or users select anvil skills from the dropdown, the command uses bare slugs (e.g., `/breadcrumb`) — but the SDK registers anvil plugin skills with the `anvil:` namespace prefix (e.g., `anvil:breadcrumb`). This mismatch means the agent doesn't recognize the skill invocation, never calls the Skill tool, and the [SKILL.md](http://SKILL.md) content is never loaded.

**Fix**: Use the `anvil:` prefix consistently in all three places where skill names appear:

1. **Skill-to-skill references** in [SKILL.md](http://SKILL.md) files (agent-to-agent spawning)
2. **UI dropdown insertion** when user selects a anvil skill
3. **Decompose skill examples** that spawn child agents with skill invocations

## Changes

### 1. Breadcrumb-loop [SKILL.md](http://SKILL.md) — spawn prompt

**File**: `~/.anvil/skills/breadcrumb-loop/SKILL.md` (line 33) **Also**: `plugins/anvil/skills/breadcrumb-loop/SKILL.md` (mirror copy)

```diff
-    prompt: `/breadcrumb ${DIR} ${i}`,
+    prompt: `/anvil:breadcrumb ${DIR} ${i}`,
```

Also update the prose reference on line 9:

```diff
-Each agent picks up where the last left off via the `/breadcrumb` skill.
+Each agent picks up where the last left off via the `/anvil:breadcrumb` skill.
```

### 2. Decompose [SKILL.md](http://SKILL.md) — spawn examples

**File**: `~/.anvil/skills/decompose/SKILL.md` (lines 92–93) **Also**: `plugins/anvil/skills/decompose/SKILL.md` (mirror copy)

```diff
-  anvil.spawn({ prompt: "Use /decompose to execute: plans/my-task/01-setup-database.md" }),
-  anvil.spawn({ prompt: "Use /decompose to execute: plans/my-task/02-auth-module.md" }),
+  anvil.spawn({ prompt: "Use /anvil:decompose to execute: plans/my-task/01-setup-database.md" }),
+  anvil.spawn({ prompt: "Use /anvil:decompose to execute: plans/my-task/02-auth-module.md" }),
```

### 3. Skill trigger handler — UI dropdown insert text

**File**: `src/lib/triggers/handlers/skill-handler.ts` (lines 46–53)

When the user selects a anvil-source skill from the `/` dropdown, the inserted text should include the `anvil:` prefix so the agent sees the fully-qualified name.

```diff
     return skills.map((skill) => ({
       id: skill.slug,
-      label: `/${skill.slug}`,
+      label: skill.source === 'anvil' ? `/anvil:${skill.slug}` : `/${skill.slug}`,
       description: skill.description || "",
       icon: SOURCE_ICONS[skill.source],
-      insertText: `/${skill.slug} `,
+      insertText: skill.source === 'anvil' ? `/anvil:${skill.slug} ` : `/${skill.slug} `,
       secondaryLabel: SOURCE_LABELS[skill.source],
     }));
```

This only affects `anvil`-source skills. Project, personal, and legacy command skills are unaffected.

## Phases

- [x] Update breadcrumb-loop [SKILL.md](http://SKILL.md): `/breadcrumb` → `/anvil:breadcrumb` (both `~/.anvil/skills/` and `plugins/anvil/skills/`)

- [x] Update decompose [SKILL.md](http://SKILL.md): `/decompose` → `/anvil:decompose` (both locations)

- [x] Update skill trigger handler: prefix `anvil:` for anvil-source skills in label and insertText

- [ ] Test: run a breadcrumb-loop and verify the child agent invokes the Skill tool

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to Change

| File | Change |
| --- | --- |
| `~/.anvil/skills/breadcrumb-loop/SKILL.md` | `/breadcrumb` → `/anvil:breadcrumb` |
| `plugins/anvil/skills/breadcrumb-loop/SKILL.md` | Same (mirror copy) |
| `~/.anvil/skills/decompose/SKILL.md` | `/decompose` → `/anvil:decompose` in spawn examples |
| `plugins/anvil/skills/decompose/SKILL.md` | Same (mirror copy) |
| `src/lib/triggers/handlers/skill-handler.ts` | Prefix `anvil:` for anvil-source skills in label + insertText |
