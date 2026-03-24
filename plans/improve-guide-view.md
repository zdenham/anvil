# Improve Guide View

Redesign the guide shown in empty panes to communicate Anvil's value proposition and consolidate the two separate states (no-repo welcome vs. guide reference) into one unified view.

**Current state:** `empty-pane-content.tsx` renders either a bare "Welcome to Mort / Add a project" screen (no repo) or `GuideContent` (shortcuts + orchestration + modes). These should be one view.

## Design

### Unified layout (both states)

The guide always renders the same content. When no repo is configured, the "Import existing" / "Create new project" buttons appear inline within the guide (not as a replacement for it). The thread input at the bottom is disabled when no repo exists (already works this way).

### Content sections (top to bottom)

1. **Hero / value prop** (new)

   - Anvil logo + tagline
   - One-liner: "The IDE built for pushing the boundaries of parallel coding agents."
   - Brief elaboration (2-3 sentences max): Anvil lets you run many agents simultaneously across isolated workspaces, coordinated by plans. Think of it as a control tower for AI-assisted development.

2. **Core concepts** (new)

   - **Thread** — A conversation with an agent. Each thread runs in its own context with full tool access.
   - **Workspace** — An isolated git worktree where an agent operates. Changes stay contained until you merge.
   - **Plan** — A structured breakdown of work. Agents read plans to stay aligned. You review and approve before implementation.
   - **REPL** — Programmatic agent coordination. Script agent behavior, run queries, orchestrate complex workflows.

3. **Plan-first development** (new)

   - Short paragraph explaining the workflow: write a plan → decompose into phases → agents execute in parallel → review diffs → merge.
   - Why it matters: plans give you control over what agents do before they do it. You stay in the loop without micromanaging every edit.

4. **Shortcuts** (keep existing)

   - Same grid layout, same shortcuts.

5. **Orchestration commands** (keep existing, minor refresh)

   - `/decompose`, `/breadcrumb-loop`, `/orchestrate` — keep as-is.

6. **Modes** (keep existing)

   - Implement, Plan, Approve — keep as-is.

7. **Get started** (conditional, replaces old welcome screen)

   - Only shown when no repository is configured.
   - Same two buttons: "Import existing" / "Create new project".
   - Positioned after the guide content, before the input.

### Visual style

- Keep the existing monospace section headers and muted color palette.
- Hero section can be slightly larger text but should not feel like marketing — keep it developer-focused and understated.
- Core concepts use the same `ConceptRow`-style layout (bold name + description).
- Plan-first section is just a short `<p>` block, same text styling as descriptions.

## Files to change

- `src/components/content-pane/guide-content.tsx` — Add hero, core concepts, plan-first sections. Accept an optional `showGetStarted` prop (or similar) to conditionally render the import/create buttons.
- `src/components/content-pane/empty-pane-content.tsx` — Remove the conditional branch. Always render `<GuideContent />`, passing a flag for the no-repo state. Move the import/create button handlers into `GuideContent` or pass them as props.

## Phases

- [x] Add hero, core concepts, and plan-first content to `guide-content.tsx`

- [x] Consolidate the two states in `empty-pane-content.tsx` into one unified guide

- [x] Verify both states render correctly (with repo and without repo)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Notes

- Use "Anvil" for all new copy (the rename plan exists separately — this just uses the new name in new content).
- The onboarding `WelcomeStep.tsx` is a separate flow and not in scope here.
- Keep the guide scannable — developers skim, they don't read walls of text.