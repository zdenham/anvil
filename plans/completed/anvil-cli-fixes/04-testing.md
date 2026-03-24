# Testing

**Dependencies:** 01, 02, 03 must be completed first

## Validation Tests

```bash
# Type validation - should error
anvil tasks update --id=xxx --type=invalid
# Expected: Error "Invalid type "invalid". Must be: work, investigate"

anvil tasks update --id=xxx --type=work
# Expected: Success (if task exists)

# Status validation - should error
anvil tasks update --id=xxx --status=bad
# Expected: Error "Invalid status "bad". Must be: draft, backlog, ..."

anvil tasks update --id=xxx --status=in-progress
# Expected: Success (if task exists)

# Tags parsing
anvil tasks update --id=xxx --tags=""
# Expected: tags set to [] (empty array)

anvil tasks update --id=xxx --tags="foo,bar,baz"
# Expected: tags set to ["foo", "bar", "baz"]

anvil tasks update --id=xxx --tags="  foo , bar  "
# Expected: tags set to ["foo", "bar"] (trimmed)
```

## Help Tests

```bash
# Bare command - exit 0
anvil
echo $?  # Should be 0

# Help flag
anvil help
anvil --help

# Tasks help
anvil tasks
anvil tasks --help

# Per-command help
anvil tasks list --help
anvil tasks get --help
anvil tasks rename --help
anvil tasks update --help
anvil tasks delete --help
anvil tasks associate --help
anvil tasks disassociate --help
```

## Regression Tests

```bash
# Existing functionality should still work
anvil tasks list
anvil tasks list --json
anvil tasks get --id=<existing-task-id>
anvil tasks get --slug=<existing-task-slug>
```

## Checklist

- [ ] Invalid type errors correctly
- [ ] Invalid status errors correctly
- [ ] Empty tags results in `[]`
- [ ] `anvil` shows help, exits 0
- [ ] `anvil help` shows help
- [ ] `anvil tasks` shows tasks help
- [ ] All `--help` flags work
- [ ] Existing commands unchanged
