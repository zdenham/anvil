# Investigation: Is the Breadcrumb Skill Being Properly Loaded?

**Thread investigated**: `52053adc-36f3-42cd-ac95-243922f124e5`
**Prompt given**: `/breadcrumb plans/breadcrumbs/unique-terminal-names 1`
**Parent thread**: `ad521e52-71d9-419e-9d84-d0193d4d782f` (breadcrumb-loop)

## Findings

### 1. The Skill Tool was NOT invoked

The agent used these tools: `Agent, Bash, Edit, Glob, Grep, Read, TodoWrite, Write`. The `Skill` tool was never called. The agent treated `/breadcrumb ...` as a plain text instruction and interpreted it on its own.

### 2. The SKILL.md was never read

The agent never read `~/.mort/skills/breadcrumb/SKILL.md` (or any other SKILL.md path). It read the breadcrumb `readme.md`, the plan file, `docs/agents.md`, and various source files — but never the skill specification itself.

### 3. The agent "winged it" and got close enough

Despite never loading the skill, the agent:
- Read the breadcrumb readme.md and understood the objective
- Did the implementation work and committed along the way
- Wrote a progress file (`001-progress.md`)
- Mentioned `BREADCRUMB_COMPLETE` in its final message (said "Not signaling BREADCRUMB_COMPLETE")

This worked because the breadcrumb concept is intuitive and the readme.md provided the objective. But **none of the specific skill rules were enforced** — the 50-line limit, the exact progress file format, the "never mention the signal string" rule, etc.

### 4. Why the Skill tool wasn't invoked

The agent runner configures the SDK with:
```ts
// agents/src/runners/shared.ts:1420
plugins: [{ type: "local" as const, path: config.mortDir }],
```

This tells the Claude Code SDK to discover skills from `~/.mort/skills/`. The SDK registers them with a `mort:` namespace prefix and lists them in a system-reminder:
```
- mort:breadcrumb: Pick up a long-running task from a breadcrumb directory...
```

But the prompt says `/breadcrumb` (no `mort:` prefix). The SDK instruction says:
> When users reference a "/<something>", they are referring to a skill. Use this tool to invoke it.

The agent likely saw `/breadcrumb` in the prompt but the available skill listed as `mort:breadcrumb`. It either:
1. Didn't match the two (prefix mismatch)
2. Decided to interpret the prompt directly rather than invoke the Skill tool

Either way, the skill content was never expanded into the agent's context.

### 5. The system-reminders aren't stored in state.json

The thread's `state.json` only stores user and assistant messages — no tool results, no system-reminders. The SDK injects system-reminders dynamically at API call time. This means we can't directly verify from the thread state whether the skill listing was present, but given the plugin config, it almost certainly was.

## Impact

The breadcrumb skill's specific instructions are **not being loaded** when invoked via `mort.spawn()`. The agent is operating on vibes rather than the actual skill specification. This means:

- The `BREADCRUMB_COMPLETE` signal rules (including our new "never mention" rule) won't be followed
- Progress file format/naming conventions may drift
- The 50-line limit on breadcrumb files isn't enforced
- Any future skill refinements won't take effect

## Root Cause

The breadcrumb-loop SKILL.md spawns the child with:
```js
const result = await mort.spawn({
  prompt: `/breadcrumb ${DIR} ${i}`,
  ...
});
```

This passes `/breadcrumb` as a raw prompt. The child agent is expected to recognize this as a skill invocation and call the `Skill` tool. But the `mort:` namespace prefix creates ambiguity, and the agent chose the direct interpretation path instead.

## Options

### A. Pre-expand the skill content in the spawn prompt

Instead of passing `/breadcrumb ${DIR} ${i}` and relying on the child agent to invoke the Skill tool, the parent agent reads the skill content and injects it directly into the spawn prompt.

The breadcrumb-loop SKILL.md would change to something like:
```js
const skillContent = await mort.readFile("plugins/mort/skills/breadcrumb/SKILL.md");
const result = await mort.spawn({
  prompt: `${skillContent}\n\n## Arguments\n\n${DIR} ${i}`,
  ...
});
```

**Pro**: Guarantees the skill content is in context, no dependency on Skill tool behavior.
**Con**: Requires `mort.readFile()` or similar SDK method. Couples the loop to the skill file path.

### B. Use the fully-qualified skill name in the prompt

Change the spawn prompt to `/mort:breadcrumb ${DIR} ${i}` so the child agent sees a direct match to the available skill listing.

**Pro**: Simple one-line change. Lets the SDK handle skill expansion naturally.
**Con**: Still relies on the agent choosing to invoke the Skill tool rather than interpreting directly.

### C. Add a `skill` option to `mort.spawn()`

Add a first-class `skill` parameter to the spawn options that pre-expands the skill content server-side before the agent sees the prompt:
```js
const result = await mort.spawn({
  skill: "breadcrumb",
  args: `${DIR} ${i}`,
  ...
});
```

**Pro**: Clean API. Guarantees skill expansion. No ambiguity.
**Con**: Requires new SDK feature in child-spawner.

### D. Make the child agent's system prompt explicitly instruct skill invocation

Add to the agent's system prompt: "When your prompt starts with /, always invoke the Skill tool before doing anything else."

**Pro**: No API changes needed.
**Con**: Still relies on model compliance. Fragile.

## Recommendation

**Option B** is the quickest fix — change `/breadcrumb` to `/mort:breadcrumb` in the breadcrumb-loop SKILL.md. Test whether this causes the child agent to invoke the Skill tool.

If that doesn't reliably trigger Skill tool invocation, escalate to **Option C** which makes skill expansion deterministic rather than relying on model behavior.
