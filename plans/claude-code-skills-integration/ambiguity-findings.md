# Claude Code Skills Integration - Ambiguity & Risk Analysis

This document consolidates findings from parallel analysis of all 8 sub-plans in the skills integration project.

---

## Executive Summary

| Plan | Ambiguities | High-Risk | Missing Info | Critical Issues |
|------|-------------|-----------|--------------|-----------------|
| 01-types-foundation | 5 | 4 | 6 | Type location conflicts, sync/async mismatch |
| 02-skills-store | 5 | 4 | 6 | Integration with hydration, ID stability |
| 03-skills-service | 5 | 5 | 7 | Adapter interface mismatch, `await` on sync method |
| 04-slash-command-trigger | 5 | 5 | 6 | `secondaryLabel` not in type, icon system incompatibility |
| 05-ui-display | 5 | 5 | 7 | Breaking `Turn` vs `ThreadMessage` interface |
| 06-settings-ui | 5 | 3 | 6 | File path mismatches, `useWorktreeStore` may not exist |
| 07-agent-injection | 5 | 5 | 6 | Duplicate types, adapter doesn't implement interface |
| 08-integration-testing | 7 | 6 | 9 | No test framework specified, race condition risks |

**Top 5 Critical Issues Across All Plans:**
1. **Type Architecture Fragmentation** - Types defined in 3+ locations with different structures
2. **Sync/Async Inconsistency** - Some adapters async, some sync, interface promises not matched
3. **Interface Mismatches** - `Turn` vs `ThreadMessage`, adapter signatures don't align
4. **Missing Integration Points** - How do plans connect to existing hydration, routing, etc.?
5. **No Test Infrastructure** - 08 lists tests but no framework, fixtures, or mocking strategy

---

## Plan 01: Types Foundation

### Ambiguities

1. **Type Location Conflict**
   - Plan creates types in `src/entities/skills/types.ts`
   - But imports show `@/entities/skills/types` being used in `core/adapters/types.ts`
   - This breaks the pattern where `core/` types are environment-agnostic
   - **Question:** Should types live in `core/types/skills.ts` and be re-exported?

2. **Unclear Slug Generation**
   - `slug: string; // Directory/file name for lookups (lowercase)`
   - No normalization rules specified for `My-Cool-Skill` → `my-cool-skill`?

3. **Ambiguous `id` Field**
   - `id: string; // Stable UUID`
   - How is it generated? Deterministic from path? Persisted? Fresh each discovery?

4. **Frontmatter Keys vs TypeScript**
   - Uses kebab-case (`user-invocable`) but accessed from TypeScript
   - No mapping layer specified

5. **`SkillsAdapter` Sync vs Async**
   - Interface defines `Promise<T>` returns
   - Existing `FileSystemAdapter` is synchronous
   - Breaks established pattern

### High-Risk Areas

1. **Type Duplication with Plan 07**
   - 07-agent-injection defines same `SkillSource` and `SkillContent` types
   - Will drift out of sync

2. **Import Path Won't Compile**
   - `import type { SkillMetadata } from '@/entities/skills/types'` in core
   - `@/` alias doesn't exist in `core/` package

3. **Missing Export Strategy**
   - No specification of which index files need updating

4. **No Zod Schemas**
   - Other entity types have runtime validation
   - Skills have no schema

### Questions to Resolve

- [ ] Where should canonical skill types live? `core/types/` or `src/entities/`?
- [ ] Should `SkillsAdapter` be sync or async? Why different from other adapters?
- [ ] How is skill `id` generated and is it stable across restarts?
- [ ] What is the `~/.mort/` directory and does it need creation elsewhere?

---

## Plan 02: Skills Store

### Ambiguities

1. **Missing `.js` Extensions**
   - Codebase uses `'./types.js'` pattern
   - Plan omits extensions, may cause resolution issues

2. **"Same Entity Pattern" Divergence**
   - Quick-actions has `_applyUpdate`, `_applyReorder`, `createdAt/updatedAt`
   - Skills store has none of these - is this intentional?

3. **`userInvocable` Double-Filter**
   - `getAll()` filters on `userInvocable`
   - But 03-skills-service already excludes `user-invocable: false` during discovery
   - Redundant or intentional safety?

4. **Priority Order Undocumented**
   - `project: 0, project_command: 1, mort: 2, personal: 3, personal_command: 4`
   - Why this ordering? Users won't understand shadowing

5. **Repository Context Dependency**
   - `hydrate(skills, repoPath)` requires repo path
   - What happens on repo switch? Who triggers re-discovery?

### High-Risk Areas

1. **Search Performance**
   - Linear scan with 3x `toLowerCase().includes()` on every keystroke
   - No debouncing at store level

2. **Missing `hydrateEntities()` Integration**
   - `src/entities/index.ts` has `hydrateEntities()` that orchestrates all entities
   - Plan doesn't specify where skills hydration fits

3. **No ID Persistence**
   - Quick-actions has `slugToId` registry for stable IDs
   - Skills generate `crypto.randomUUID()` each discovery
   - IDs not stable across restarts

4. **No Listener Setup**
   - Quick-actions has `setupQuickActionListeners()`
   - No equivalent for skills

### Questions to Resolve

- [ ] How does skills hydration integrate with `hydrateEntities()`?
- [ ] What events trigger skill re-discovery?
- [ ] Should skill IDs be stable (like quick-actions) or ephemeral?
- [ ] What are the intentional differences from quick-actions pattern?

---

## Plan 03: Skills Service

### Ambiguities

1. **`await fs.joinPath()` on Sync Method**
   - Plan uses `await fs.joinPath(entry.path, 'SKILL.md')`
   - `FilesystemClient.joinPath()` is synchronous, returns `string`
   - Works but misleading

2. **"Simple Parser" Limitations Undocumented**
   - Does NOT handle nested YAML, arrays, multi-line values
   - `allowed-tools` could be YAML array but type is `string`

3. **`allowed-tools` Format**
   - Type is `string` - comma-separated? space-separated? array?
   - Downstream consumers need to know

4. **Discovery Timing/Lifecycle**
   - When should `discover()` be called?
   - Should it be debounced?
   - Blocking or background?

5. **Slug Collision for Same-Level Sources**
   - `/.claude/skills/deploy/SKILL.md` vs `/.claude/commands/deploy.md`
   - Both "project" level - which wins? Priority says skills first

### High-Risk Areas

1. **Module-Level `FilesystemClient` Instantiation**
   - `const fs = new FilesystemClient();` at module load
   - May instantiate before Tauri ready
   - Makes testing difficult

2. **Silent Shadow Without User Feedback**
   - Users won't know their personal skill is shadowed by project skill

3. **`crypto.randomUUID()` Environment Assumption**
   - Assumes `crypto` globally available
   - Needs verification for Tauri WebView

4. **No File System Watching**
   - Changes to skill files not reflected until manual rediscovery

5. **Errors Swallowed**
   - `logger.warn()` but no user feedback
   - Empty skills list with no indication why

### Questions to Resolve

- [ ] Should discovery be recursive into nested directories?
- [ ] How should symlinked skill directories be handled?
- [ ] What feedback should users get about shadowed skills?
- [ ] Should `allowed-tools` be a string or array?

---

## Plan 04: Slash Command Trigger

### Ambiguities

1. **`secondaryLabel` Not in `TriggerResult` Type**
   - Plan uses `secondaryLabel: this.getSourceLabel(skill.source)`
   - `TriggerResult` interface has no `secondaryLabel` field
   - Type needs extending

2. **Icon String Mapping Mismatch**
   - Returns `"sparkles"`, `"user"`, `"folder"` etc.
   - `TriggerDropdown` expects file extensions for `getFileIcon()`
   - All skill icons will render as default `File` icon

3. **Inconsistent Icon Names**
   - This plan: `"folder-code"` for `project_command`
   - Parent plan: `"folder-terminal"` for same
   - Which is correct?

4. **Escape Sequence Behavior**
   - `//` should "insert literal `/`"
   - Does `//` become single `/` (transformation) or stay as `//`?

5. **URL False Positive Claims**
   - Plan says existing system handles URLs
   - Not verified - `http://` would have `/` after colon, not whitespace

### High-Risk Areas

1. **Discovery on Every Keystroke**
   - `await skillsService.discover(context.rootPath)` on every `/` trigger
   - Filesystem operations before debounce kicks in
   - Could cause noticeable lag

2. **Race Condition Potential**
   - User types `/re` → discovery starts
   - User types `/review` → new discovery starts
   - `AbortSignal` passed to `search()` but not `discover()`

3. **Singleton vs Instance Inconsistency**
   - `FileTriggerHandler` registered as new instance
   - Plan exports singleton `skillTriggerHandler`

4. **Dropdown Assumes File Context**
   - `EMPTY_STATES` says "No matching files found"
   - ARIA label says "X files found"
   - Wrong for skills

5. **Missing `rootPath` Handling**
   - Returns empty when `!context.rootPath`
   - But personal/mort skills don't need `rootPath`

### Questions to Resolve

- [ ] Should `TriggerResult` interface be extended with `secondaryLabel`?
- [ ] How should skill icons be rendered differently from file icons?
- [ ] Should personal/mort skills be discoverable without a repo open?
- [ ] What's the correct escape behavior for `//`?

---

## Plan 05: UI Display

### Ambiguities

1. **"Shares Logic with Agent" Not Implemented**
   - Plan says parser "shares logic with agent"
   - Implementation is entirely self-contained
   - Where is shared module?

2. **Remaining Text Display**
   - Comment says `{/* existing content rendering */}`
   - No specification of how existing wrapper/styling preserved

3. **Regex Edge Cases**
   - `gim` flags include case-insensitive, but then calls `.toLowerCase()`
   - What about `/skill/another-skill`? Nested patterns?

4. **Multiple Skills Parsing**
   - `/commit some args /review-pr 123`
   - Args regex `[^\n]*` captures everything - including second skill

5. **"Stale" Definition**
   - Used for: file no longer exists AND slug not found
   - Different scenarios, same treatment

### High-Risk Areas

1. **BREAKING: Wrong Component Interface**
   - Plan: `function UserMessage({ message }: { message: ThreadMessage })`
   - Actual: `function UserMessage({ turn }: { turn: Turn })`
   - Uses `getUserTurnPrompt(turn)` not `message.content`
   - **Will not compile as written**

2. **Lookbehind Browser Compatibility**
   - `(?<=\s)` not supported in Safari < 16.4, Firefox < 78
   - Could break entire skill parsing

3. **Store Hook vs Direct State Access**
   - Component uses `useSkillsStore()` hook
   - Service uses `useSkillsStore.getState()`
   - Mixed patterns can cause stale data

4. **Async State in Click Handler**
   - No debouncing or click prevention during loading
   - Rapid clicks could cause multiple async reads

5. **Entity Path Doesn't Exist**
   - `import { skillsService } from "@/entities/skills"`
   - No files at `src/entities/skills/` yet
   - Hard dependency on 02, 03

### Questions to Resolve

- [ ] Fix the `Turn` vs `ThreadMessage` interface mismatch
- [ ] How should parser logic be shared with agent (07)?
- [ ] What's the browser support matrix for lookbehind?
- [ ] How to handle multiple skills on one line?

---

## Plan 06: Settings UI

### Ambiguities

1. **File Path Mismatch**
   - Plan: `src/components/settings/skills-settings.tsx`
   - Existing settings: `src/components/main-window/settings/`
   - Two different settings directories exist

2. **`SettingsSection` Import Path Wrong**
   - Plan: `import { SettingsSection } from "./settings-section"`
   - Actual location: `src/components/main-window/settings-section.tsx`
   - Relative path won't resolve

3. **"Add to Settings Routes" Vague**
   - No file specified
   - No explanation of routing mechanism
   - No insertion point indicated

4. **`useWorktreeStore` May Not Exist**
   - Only found in plan file itself
   - Existing code uses `worktreeService`
   - Dependency on unrealized work?

5. **CSS Class System Mismatch**
   - Existing: `text-surface-400`, `bg-surface-800/30`
   - Plan: `text-muted-foreground`, `border-b`
   - Different design systems

### High-Risk Areas

1. **Discovery on Every Settings Open**
   - `useEffect` triggers `skillsService.discover()` on mount
   - Should use `needsRediscovery()` check

2. **Store Selection Causes Re-renders**
   - `state.getAll()` creates new array each time
   - Quick-actions uses `useMemo` pattern instead

3. **Missing Loading State**
   - No spinner while skills discover
   - "No skills found" could show during loading

### Questions to Resolve

- [ ] Which settings directory should this live in?
- [ ] Does `useWorktreeStore` exist or should plan use `worktreeService`?
- [ ] What's the settings navigation structure?
- [ ] Should discovery check `needsRediscovery()` first?

---

## Plan 07: Agent Injection

### Ambiguities

1. **Duplicate Types vs Import**
   - Creates `SkillSource`, `SkillContent`, `SkillMetadata` in `agents/src/lib/skills/types.ts`
   - Same types exist in 01-types-foundation
   - `SkillMetadata` here is stripped-down version (missing `id`, `name`, `description`, etc.)

2. **Adapter Doesn't Implement Interface**
   - Interface (01): `discover()` returns `Promise<SkillMetadata[]>`
   - Implementation (07): `findBySlug()` returns `SkillMetadata | null`
   - Completely different signatures

3. **`parseFrontmatter` Location**
   - Defined in `inject-skill.ts` but not exported
   - Called in runner integration snippet but not imported
   - Different signature than 03-skills-service version

4. **Import Path Direction**
   - `core/adapters/node/skills-adapter.ts` imports from `agents/src/`
   - Breaks dependency direction (agents should depend on core)

5. **Per-run vs Session Context**
   - "Skills only injected for current turn, not persisted"
   - What about multi-turn skill workflows?

### High-Risk Areas

1. **System Prompt Triple-Layering**
   - SDK base prompt + `buildSystemPrompt()` + skill injection
   - Appending to append creates confusing layers

2. **Regex Risks**
   - Lookbehind `(?<=\s)` browser support
   - `/path/to/file` matches `path` as skill
   - `https://example.com/skill` matches `skill`
   - Code blocks not excluded

3. **Silent Failure on Missing Skills**
   - User types `/my-skil` (typo) → no feedback
   - Message goes through without skill

4. **Sync File Operations in Hot Path**
   - `fs.existsSync`, `fs.readdirSync`, `fs.readFileSync`
   - Could block event loop on network storage

5. **`shared.ts` Already Modified**
   - File shows as modified in git status
   - Merge conflict risk with in-flight changes

### Questions to Resolve

- [ ] Should agent types import from `core/` or be separate?
- [ ] Why doesn't `NodeSkillsAdapter` implement `SkillsAdapter` interface?
- [ ] Where should `parseFrontmatter` utility live?
- [ ] What feedback should users get for missing/typo'd skills?

---

## Plan 08: Integration Testing

### Ambiguities

1. **No `user-invocable: false` Fixture**
   - Test says skill should not appear in results
   - No fixture created to test this

2. **"Both injected in order" - What Order?**
   - Message order? Priority order? Alphabetical?

3. **"Very long" Not Defined**
   - "Truncated in chip display" - at what length?
   - Where is truncation applied?

4. **URL Context Definition**
   - "Type `/` in URL | No dropdown"
   - What qualifies as URL context? Only `http://`?

5. **`$ARGUMENTS` in Expanded View**
   - Should placeholders be substituted or shown literal?

6. **Legacy Commands as "Skills"**
   - "Returns 4 skills" but one is a command
   - Are commands counted as skills?

7. **Discovery Refresh Frequency**
   - "Discovery refreshes when `/` typed"
   - Full refresh every time? Cache check first?

### High-Risk Areas

1. **Race Conditions Acknowledged But Unaddressed**
   - Test: "Concurrent skill discovery | No race conditions"
   - No implementation guidance provided
   - `crypto.randomUUID()` could give same skill different IDs

2. **Frontmatter Parser Limitations**
   - Simple regex parser doesn't handle real YAML
   - "Malformed YAML" test exists but parser's definition differs from spec

3. **Regex Lookbehind Compatibility**
   - `(?<=\s)` not supported everywhere
   - Could break all skill matching

4. **Store Hydration Race**
   - Rapid project switching could hydrate wrong skills

5. **No System Prompt Size Limits**
   - Multiple large skills could exceed API limits

6. **File I/O Performance**
   - "Skill content read fresh each time (no stale cache)"
   - Every expand, every message reads from disk

### Missing Information

1. **No Test Framework Specified**
   - Jest? Vitest? Playwright?
   - How are fixtures created/cleaned?

2. **No Mocking Strategy**
   - How to mock filesystem for unit tests?

3. **No Cross-Platform Testing**
   - Windows path handling?
   - Case-sensitivity differences?

4. **No Accessibility Tests**
   - Keyboard navigation?
   - Screen reader support?

5. **Thread Persistence Format**
   - How are skills stored in persisted threads?
   - What if skill slug changes?

### Questions to Resolve

- [ ] What test framework and infrastructure will be used?
- [ ] How should race conditions be prevented?
- [ ] What is the maximum system prompt size?
- [ ] Should skills be persisted in thread data or reconstructed from slug?

---

## Cross-Cutting Concerns

### Type Architecture

```
Current State (Fragmented):
├── 01: src/entities/skills/types.ts (SkillMetadata with 10+ fields)
├── 07: agents/src/lib/skills/types.ts (SkillMetadata with 3 fields)
├── 07: core/adapters/node/skills-adapter.ts imports from agents (wrong direction)
└── Multiple plans define SkillSource independently

Recommended:
├── core/types/skills.ts (canonical types)
├── src/entities/skills/types.ts (re-exports from core)
└── agents/src/ (imports from core)
```

### Adapter Interface Alignment

| Plan | Method | Returns | Sync/Async |
|------|--------|---------|------------|
| 01 interface | `discover(repo, home)` | `Promise<SkillMetadata[]>` | Async |
| 03 service | `discover(repo)` | `void` (mutates store) | Async |
| 07 adapter | `findBySlug(slug, repo, home)` | `SkillMetadata \| null` | Sync |

**Recommendation:** Align on a single pattern. If adapter is meant to be injectable/testable, it should implement the interface.

### Shared Utilities Needed

1. **`parseFrontmatter()`** - Currently duplicated with different signatures
2. **Skill regex pattern** - Used in 04, 05, 07 with variations
3. **Source priority/shadowing logic** - Scattered across plans
4. **Icon mapping** - Different in 04, 05, 06 (emojis vs strings vs Lucide)

---

## Recommended Resolution Order

1. **Resolve type architecture first** (affects all plans)
2. **Fix 05-ui-display interface mismatch** (blocking - won't compile)
3. **Align adapter signatures** (01 interface vs 07 implementation)
4. **Define shared utilities location** (`parseFrontmatter`, regex, icons)
5. **Specify test infrastructure** (needed for all acceptance criteria)
6. **Document shadowing/priority for users** (UX concern)
7. **Add browser compatibility notes** (lookbehind regex)
