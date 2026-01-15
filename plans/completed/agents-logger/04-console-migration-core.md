# Subplan 4: Console Migration - Core Package

**Parallel Group: B** - Can run concurrently with Subplan 3
**Dependencies: Subplan 1 (logger infrastructure must be complete)**

## Scope

Replace ALL direct `console.*` calls in core package with `logger.*` calls.

## Files to Audit

All files in `core/**/*.ts`

## Search Commands

```bash
# Find all console.log calls
grep -rn "console\.log" core/ --include="*.ts"

# Find all console.error calls
grep -rn "console\.error" core/ --include="*.ts"

# Find all console.warn calls
grep -rn "console\.warn" core/ --include="*.ts"

# Find all console.debug calls
grep -rn "console\.debug" core/ --include="*.ts"
```

## Migration Rules

| Old | New |
|-----|-----|
| `console.log(...)` | `logger.info(...)` or `logger.debug(...)` |
| `console.error(...)` | `logger.error(...)` |
| `console.warn(...)` | `logger.warn(...)` |
| `console.debug(...)` | `logger.debug(...)` |

## Considerations

The core package is shared between:
1. Agents (Node.js subprocess) - needs structured JSON output
2. Frontend (Tauri) - may have different logging needs

Options:
1. **Conditional logger** - detect environment and output differently
2. **Inject logger** - pass logger as dependency
3. **Separate loggers** - core uses a different logger than agents

Recommended: Create a logger in core that agents re-exports, or have core accept a logger interface.

## Completion Criteria

- [ ] Zero `console.log` calls in core package
- [ ] Zero `console.error` calls in core package
- [ ] Zero `console.warn` calls in core package
- [ ] Zero `console.debug` calls in core package
- [ ] Logging works correctly in both agents and frontend contexts
- [ ] Build passes: `pnpm --filter core typecheck`
