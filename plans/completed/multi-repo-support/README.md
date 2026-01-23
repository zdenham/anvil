# Multi-Repository Support - Execution Plan

## Dependency Graph

```
                    ┌─────────────────┐
                    │  01-add-repo    │
                    │   (settings)    │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 02-mru-nav      │ │ 03-repo-mgmt    │ │ 04-backend      │
│  (spotlight)    │ │  (settings)     │ │  (rust)         │
└────────┬────────┘ └─────────────────┘ └─────────────────┘
         │
         ▼
┌─────────────────┐
│ 05-polish       │
│  (inbox+edges)  │
└─────────────────┘
```

## Parallel Execution Strategy

### Wave 1 (Sequential - Prerequisite)
- `01-add-repository.md` - Must complete first (establishes multi-repo data flow)

### Wave 2 (Parallel - 3 agents)
These can run simultaneously after Wave 1:
- `02-mru-navigation.md` - Core spotlight changes
- `03-repository-management.md` - Settings UI enhancements
- `04-backend-validation.md` - Rust commands

### Wave 3 (Sequential - Depends on 02)
- `05-polish-edge-cases.md` - Requires MRU navigation to be complete

## File Ownership (Prevents Conflicts)

| Sub-plan | Exclusive Files |
|----------|-----------------|
| 01 | `repository-settings.tsx` (add button only), `repositories/service.ts` (validation) |
| 02 | `spotlight/spotlight.tsx`, `worktrees/service.ts`, `core/types/repositories.ts` |
| 03 | `repository-settings.tsx` (remove/rename/status sections) |
| 04 | `src-tauri/src/repo_commands.rs` (new), `src-tauri/src/lib.rs` (registration) |
| 05 | `src/components/inbox/*.tsx`, spotlight display refinements |

**Note**: Plans 01 and 03 both touch `repository-settings.tsx` but different sections. If running in parallel, coordinate or run 01 first.

## Estimated Complexity

| Plan | Complexity | Files Changed |
|------|------------|---------------|
| 01 | Low | 2 |
| 02 | Medium | 4 |
| 03 | Low | 1-2 |
| 04 | Medium | 2-3 |
| 05 | Low-Medium | 3-4 |
