# 08: Integration Testing

## Overview

End-to-end testing and final integration work. Verify all components work together correctly.

## Phases

- [ ] Create test skill fixtures
- [ ] Test discovery flow
- [ ] Test slash command UI
- [ ] Test agent injection
- [ ] Test UI display
- [ ] Test edge cases
- [ ] Polish and bug fixes

---

## Dependencies

- **04-slash-command-trigger**
- **05-ui-display**
- **06-settings-ui**
- **07-agent-injection**

---

## Test Fixtures

Create test skills in appropriate locations:

### ~/.mort/skills/test-mort/SKILL.md

```markdown
---
name: test-mort
description: Test skill for Mort-specific functionality
---

# Test Mort Skill

This is a test skill located in ~/.mort/skills/

Arguments received: $ARGUMENTS
```

### ~/.claude/skills/test-personal/SKILL.md

```markdown
---
name: test-personal
description: Test personal skill
---

# Test Personal Skill

This is a test skill located in ~/.claude/skills/
```

### <repo>/.claude/skills/test-project/SKILL.md

```markdown
---
name: test-project
description: Test project skill (should shadow personal)
---

# Test Project Skill

This is a project-level skill. It should take priority over personal skills with the same name.
```

### ~/.claude/commands/test-command.md

```markdown
---
description: Test legacy command format
---

This is a legacy command file. It should still work alongside modern skills.
```

---

## Test Scenarios

### Discovery Tests

| Test | Expected |
|------|----------|
| `skillsService.discover()` with all fixtures | Returns 4 skills |
| Project skill with same slug as personal | Project wins (priority) |
| Skill with `user-invocable: false` | Not in results |
| Malformed YAML in frontmatter | Skill skipped, warning logged |
| Non-existent directory | Silently skipped |

### Slash Command UI Tests

| Test | Expected |
|------|----------|
| Type `/` at start | Dropdown opens with skills |
| Type `/` after space | Dropdown opens |
| Type `//` | Literal `/` inserted |
| Type `/` in URL | No dropdown |
| Filter by typing | Skills filtered |
| Select with Enter | `/<slug> ` inserted |
| Press Escape | Dropdown closes |

### Agent Injection Tests

| Test | Expected |
|------|----------|
| `/test-mort hello world` | System prompt has skill content, `$ARGUMENTS` = "hello world" |
| `/missing-skill` | No injection, message sent as-is |
| Multiple skills | Both injected in order |
| No skills | No system prompt append |

### UI Display Tests

| Test | Expected |
|------|----------|
| Message with `/test-mort args` | Skill chip rendered |
| Click chip | Expands to show content |
| Delete skill file, reload | Chip shows "stale" |
| Multiple skills | Multiple chips |

### Edge Cases

| Test | Expected |
|------|----------|
| Empty skill (frontmatter only) | Valid, empty `<skill>` block |
| Skill with special chars in args | Args passed through correctly |
| Very long skill content | Truncated in chip display |
| Concurrent skill discovery | No race conditions |

---

## Integration Checklist

- [ ] Discovery runs at app startup
- [ ] Discovery refreshes when `/` typed
- [ ] Discovery refreshes when settings opened
- [ ] Skills persist across page reloads (via store hydration)
- [ ] Skill content read fresh each time (no stale cache)
- [ ] Thread reload shows skill chips correctly
- [ ] Settings shows current skill list
- [ ] Agent logs skill injection

---

## Performance Checks

- [ ] Discovery completes in < 500ms for typical setup
- [ ] Dropdown opens immediately (no lag)
- [ ] Skill content loads in < 100ms on expand
- [ ] No memory leaks with repeated discovery

---

## Documentation

- [ ] Update README with skills feature
- [ ] Add example skills to template
- [ ] Document skill file format
- [ ] Document trigger behavior

---

## Acceptance Criteria

- [ ] All test scenarios pass
- [ ] No console errors during normal operation
- [ ] Performance acceptable
- [ ] Documentation complete
- [ ] Feature ready for release
