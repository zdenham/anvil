# Fix Slash Command Invocation in Spawn Prompts

## Problem

When skills recursively invoke other skills via `mort.spawn()`, the slash command appears **mid-sentence** in the prompt — e.g., `"Use /mort:decompose to execute: ..."`. Claude Code only auto-expands slash commands into `<command-name>` tags when the command is at the **start** of the user message. Mid-sentence references require an extra Skill tool call round-trip, wasting tokens and adding latency.

**Evidence:** [GitHub Issue #19729](https://github.com/anthropics/claude-code/issues/19729) confirms this is intentional parsing behavior — the CLI only detects slash commands at message start. This was reproduced across multiple duplicate issues (#20047, #20816, #26251, #26473, #30182).

> Note: The official [skills documentation](https://code.claude.com/docs/en/skills) does not explicitly document this position-dependent parsing. It's confirmed via bug reports and observed behavior.

## Affected Files

Both files exist in two locations (plugin source + installed copy). Edit the plugin source; the installed copy at `~/.mort/skills/` should be synced separately.

### 1. `plugins/mort/skills/decompose/SKILL.md`

**Line 92** — the example `mort.spawn()` prompt:

```
mort.spawn({ prompt: "Use /mort:decompose to execute: plans/my-task/01-setup-database.md" })
```

Should become:

```
mort.spawn({ prompt: "/mort:decompose plans/my-task/01-setup-database.md" })
```

Also add a callout near the example explaining **why** the slash command must lead:

> **The slash command must be the first thing in the prompt.** Claude Code only auto-expands skills into `<command-name>` tags when the `/command` appears at the start of the message. If buried mid-sentence, the agent must make an extra Skill tool call to load the skill content.

### 2. `plugins/mort/skills/breadcrumb-loop/SKILL.md`

**Line 33** — the `mort.spawn()` prompt is already correct:

```
prompt: `/mort:breadcrumb ${DIR} ${i}`,
```

This one already starts with the slash command. **No code change needed**, but we should add the same explanatory callout near it so future editors don't regress it.

## Phases

- [x] Update decompose [SKILL.md](http://SKILL.md): fix spawn prompt and add callout

- [x] Update breadcrumb-loop [SKILL.md](http://SKILL.md): add explanatory callout (prompt already correct)

- [x] Sync changes to installed copies at `~/.mort/skills/`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---