# Mort CLI Fixes - Overview

## Parallel Execution Guide

These sub-plans can be executed **in parallel**:

| Plan | File | Dependencies |
|------|------|--------------|
| Input Validation | `01-input-validation.md` | None |
| Help Documentation | `02-help-documentation.md` | None |
| System Prompt Consistency | `03-system-prompt-consistency.md` | None |

**Sequential** (must wait for above):

| Plan | File | Dependencies |
|------|------|--------------|
| Testing | `04-testing.md` | All above completed |

## Current State

The CLI at `agents/src/cli/mort.ts` has all required commands. Issues to fix:

1. **Input Validation** - Invalid types/statuses silently default instead of erroring
2. **Help Documentation** - No help system, bare command errors instead of showing help
3. **System Prompt Consistency** - Agent prompts don't match actual CLI functionality

## Files Modified

| File | Modified By |
|------|-------------|
| `agents/src/cli/mort.ts` | 01, 02 |
| `agents/src/agent-types/shared-prompts.ts` | 03 |

## Out of Scope

- Thread validation (would require cross-system queries)
- List filtering (use grep/shell tools)
- Current task context (agent system responsibility)
