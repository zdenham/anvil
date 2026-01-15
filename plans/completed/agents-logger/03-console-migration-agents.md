# Subplan 3: Console Migration - Agents Package

**Parallel Group: B** - Can run concurrently with Subplan 4
**Dependencies: Subplan 1 (logger infrastructure must be complete)**

## Scope

Replace ALL direct `console.*` calls in agents package with `logger.*` calls.

## Files to Audit

All files in `agents/src/**/*.ts`:
- `agents/src/runner.ts`
- `agents/src/output.ts`
- `agents/src/agent-types/**/*.ts`
- `agents/src/lib/**/*.ts` (except logger.ts itself)
- `agents/src/tools/**/*.ts`
- `agents/src/validators/**/*.ts`

## Search Commands

```bash
# Find all console.log calls
grep -rn "console\.log" agents/src/ --include="*.ts"

# Find all console.error calls
grep -rn "console\.error" agents/src/ --include="*.ts"

# Find all console.warn calls
grep -rn "console\.warn" agents/src/ --include="*.ts"

# Find all console.debug calls
grep -rn "console\.debug" agents/src/ --include="*.ts"
```

## Migration Rules

| Old | New |
|-----|-----|
| `console.log(...)` | `logger.info(...)` or `logger.debug(...)` |
| `console.error(...)` | `logger.error(...)` |
| `console.warn(...)` | `logger.warn(...)` |
| `console.debug(...)` | `logger.debug(...)` |

## Exceptions

- `agents/src/lib/logger.ts` - The only file allowed to use `console.log`
- Any file that needs to emit structured events should use `events.emit()` instead

## Completion Criteria

- [ ] Zero `console.log` calls outside of logger.ts
- [ ] Zero `console.error` calls outside of logger.ts
- [ ] Zero `console.warn` calls outside of logger.ts
- [ ] Zero `console.debug` calls outside of logger.ts
- [ ] All files import logger from lib
- [ ] Build passes: `pnpm --filter agents typecheck`
