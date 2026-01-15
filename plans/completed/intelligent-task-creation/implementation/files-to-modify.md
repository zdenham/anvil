# Files to Modify

Complete list of files requiring changes for intelligent task creation.

## Frontend (TypeScript)

| File | Changes |
|------|---------|
| `src/entities/tasks/types.ts` | Add `slug`, `branchName`, `type`, `parentId` |
| `src/entities/tasks/service.ts` | Slug generation, conflict resolution, branch name storage |
| `src/entities/threads/types.ts` | `taskId: string \| null` |
| `src/entities/threads/service.ts` | Allow null taskId, add `associateWithTask` |
| `src/lib/slug.ts` | **NEW** - slugify and conflict resolution utilities |
| `src/components/spotlight/spotlight.tsx` | Start with null taskId |

## Backend (Rust)

| File | Changes |
|------|---------|
| `src-tauri/src/cli/tasks.rs` | **NEW** - CLI commands for task management |
| `src-tauri/src/cli/mod.rs` | Register tasks subcommand |

## Agent (TypeScript)

| File | Changes |
|------|---------|
| `agents/src/agent-types/main.ts` | **NEW** - main agent with hook registration |
| `agents/src/agent-types/index.ts` | Register main agent |
| `agents/src/hooks/task-context.ts` | **NEW** - UserPromptSubmit hook for task state injection |
| `agents/skills/route.md` | **NEW** - routing skill (liberally invoked) |
| `agents/src/lib/workspace.ts` | **NEW** - readTasksDirectory, getGitState utilities |
| `agents/src/runner.ts` | Optional taskId, hook registration, branch management |
| `agents/src/git.ts` | Add `getCurrentBranch`, `hasUncommittedChanges`, `checkoutBranch`, `branchExists` |

## Summary

- **New files**: 7
- **Modified files**: 9
- **Total**: 16 files
