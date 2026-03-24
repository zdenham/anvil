# Testing

**Dependencies:** 01, 02, 03 must be completed first

## Validation Tests

```bash
# Type validation - should error
mort tasks update --id=xxx --type=invalid
# Expected: Error "Invalid type "invalid". Must be: work, investigate"

mort tasks update --id=xxx --type=work
# Expected: Success (if task exists)

# Status validation - should error
mort tasks update --id=xxx --status=bad
# Expected: Error "Invalid status "bad". Must be: draft, backlog, ..."

mort tasks update --id=xxx --status=in-progress
# Expected: Success (if task exists)

# Tags parsing
mort tasks update --id=xxx --tags=""
# Expected: tags set to [] (empty array)

mort tasks update --id=xxx --tags="foo,bar,baz"
# Expected: tags set to ["foo", "bar", "baz"]

mort tasks update --id=xxx --tags="  foo , bar  "
# Expected: tags set to ["foo", "bar"] (trimmed)
```

## Help Tests

```bash
# Bare command - exit 0
mort
echo $?  # Should be 0

# Help flag
mort help
mort --help

# Tasks help
mort tasks
mort tasks --help

# Per-command help
mort tasks list --help
mort tasks get --help
mort tasks rename --help
mort tasks update --help
mort tasks delete --help
mort tasks associate --help
mort tasks disassociate --help
```

## Regression Tests

```bash
# Existing functionality should still work
mort tasks list
mort tasks list --json
mort tasks get --id=<existing-task-id>
mort tasks get --slug=<existing-task-slug>
```

## Checklist

- [ ] Invalid type errors correctly
- [ ] Invalid status errors correctly
- [ ] Empty tags results in `[]`
- [ ] `mort` shows help, exits 0
- [ ] `mort help` shows help
- [ ] `mort tasks` shows tasks help
- [ ] All `--help` flags work
- [ ] Existing commands unchanged
