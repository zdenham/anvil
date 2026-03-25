# Remove Skills from Settings, Show Built-in Skills in Guide

Remove the skills settings section (low value — skills are invoked via `/name`, not configured) and surface the full set of built-in anvil skills in the guide view where they're actually discoverable.

## Current state

- **Settings:** `SkillsSettings` in `settings-page.tsx` lists discovered skills with a re-sync button and creation instructions. Rarely useful — skills aren't toggled or configured, just invoked.
- **Guide:** `guide-content.tsx` has an "Orchestration" section showing only `/decompose`, `/breadcrumb-loop`, `/orchestrate`.
- **Built-in anvil skills (10 total):** commit, create-pr, address-pr-comment, address-comments, fix-ci, simplify-code, decompose, orchestrate, breadcrumb-loop, breadcrumb.

## Changes

### 1. Remove SkillsSettings from settings page

- `settings-page.tsx`: Remove the `<SkillsSettings />` component and its import.
- Do NOT delete `skills-settings.tsx` or `skill-list-item.tsx` yet — they may be useful elsewhere or can be cleaned up in a separate pass.

### 2. Expand the guide's skills section

Replace the current "Orchestration" section with a broader "Skills" section showing the most useful built-in skills, grouped logically:

**Orchestration**

- `/decompose` — Break a task into sub-plans, execute in parallel waves
- `/breadcrumb-loop` — Run a task across multiple context windows via progress files
- `/orchestrate` — Programmatic agent coordination with anvil-repl

**Workflow**

- `/commit` — Create a well-formatted conventional commit
- `/create-pr` — Create a GitHub pull request for the current branch
- `/fix-ci` — Investigate and fix a CI check failure

**Code quality**

- `/simplify-code` — Simplify and refine code for clarity and consistency
- `/address-comments` — Address unresolved PR review comments

Omit `/breadcrumb` (lower-level primitive behind breadcrumb-loop) and `/address-pr-comment` (singular version of address-comments, niche) to keep the guide scannable.

### Visual approach

Keep the existing `ConceptRow` component. Use sub-headings within the section (smaller text, same style as current "Orchestration" heading) for the three groups.

## Files to change

- `src/components/main-window/settings-page.tsx` — Remove SkillsSettings import and usage
- `src/components/content-pane/guide-content.tsx` — Expand orchestration section into full skills section with three groups

## Phases

- [x] Remove `<SkillsSettings />` from settings page

- [x] Expand guide skills section with grouped built-in skills

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---