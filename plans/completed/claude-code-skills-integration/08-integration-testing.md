# 08: Integration Testing

## Overview

End-to-end testing and final integration work. Verify all components work together correctly.

---

## Test Infrastructure

### Test Framework

This project uses **Vitest** for all testing. Configuration files:
- `/vitest.config.ts` - Main test configuration (jsdom environment, `@testing-library/jest-dom`)
- `/vitest.config.ui.ts` - UI isolation tests (happy-dom environment, faster execution)
- `/agents/vitest.config.ts` - Agent integration tests (Node environment)

### Test File Naming Convention

| Test Type | Naming Pattern | Location |
|-----------|----------------|----------|
| Unit tests | `*.test.ts` | `src/**/__tests__/` |
| UI isolation tests | `*.ui.test.tsx` | `src/**/__tests__/` |
| Integration tests | `*.integration.test.ts` | `agents/src/testing/__tests__/` |

Skills-specific tests should follow:
- **Unit tests**: `src/entities/skills/__tests__/*.test.ts`
- **UI tests**: `src/components/skills/__tests__/*.ui.test.tsx`
- **Integration tests**: `agents/src/testing/__tests__/skills.integration.test.ts`

### Running Tests

```bash
# Run all unit tests
pnpm test

# Run UI tests only
pnpm test:ui

# Run agent integration tests
cd agents && pnpm test

# Run tests in watch mode
pnpm test -- --watch

# Run specific test file
pnpm test -- src/entities/skills/__tests__/service.test.ts

# Run with coverage
pnpm test -- --coverage
```

---

## Mocking Strategy

### Mocking FilesystemClient

For unit tests, mock the `FilesystemClient` to avoid filesystem I/O:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";
import { skillsService } from "../service";

// Mock the filesystem client
vi.mock("@/lib/filesystem-client", () => ({
  filesystemClient: {
    readDir: vi.fn(),
    readFile: vi.fn(),
    exists: vi.fn(),
  },
}));

import { filesystemClient } from "@/lib/filesystem-client";

describe("skillsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("discovers skills from directory", async () => {
    vi.mocked(filesystemClient.readDir).mockResolvedValue([
      { name: "test-skill", isDirectory: true },
    ]);
    vi.mocked(filesystemClient.readFile).mockResolvedValue(`---
name: test-skill
description: A test skill
---
# Test content`);

    const skills = await skillsService.discover();
    expect(skills).toHaveLength(1);
    expect(skills[0].slug).toBe("test-skill");
  });
});
```

### Creating Temporary Directories for Integration Tests

Use the existing `TestMortDirectory` and `TestRepository` services:

```typescript
import { TestMortDirectory } from "../services/test-mort-directory.js";
import { TestRepository } from "../services/test-repository.js";

describe("skills integration", () => {
  let mortDir: TestMortDirectory;
  let repo: TestRepository;

  beforeEach(() => {
    mortDir = new TestMortDirectory().init();
    repo = new TestRepository({ fixture: "minimal" }).init();
    mortDir.registerRepository(repo);

    // Create test skill fixture
    const skillDir = join(mortDir.path, "skills", "test-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: test-skill
description: Test skill
---
# Test Skill Content`
    );
  });

  afterEach((ctx) => {
    const failed = ctx.task.result?.state === "fail";
    repo.cleanup(failed);
    mortDir.cleanup(failed);
  });
});
```

### Mocking Zustand Stores

Reset Zustand stores between tests to ensure isolation:

```typescript
import { beforeEach } from "vitest";
import { useSkillsStore } from "../store";

describe("skills store", () => {
  beforeEach(() => {
    // Reset to initial state
    useSkillsStore.setState({
      skills: [],
      isLoading: false,
      error: null,
      _hydrated: false,
    });
  });

  it("hydrates skills correctly", () => {
    const skill = createTestSkill({ slug: "test" });
    useSkillsStore.getState().hydrate([skill]);
    expect(useSkillsStore.getState().skills).toHaveLength(1);
  });
});
```

For UI tests, use the `TestStores.clear()` helper from `src/test/helpers/stores.ts`.

---

## Phases

- [x] Create test skill fixtures
- [x] Test discovery flow
- [x] Test slash command UI
- [x] Test agent injection
- [x] Test UI display
- [x] Test edge cases
- [x] Polish and bug fixes

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Dependencies

- **04-slash-command-trigger**
- **05-ui-display**
- **06-settings-ui**
- **07-agent-injection**

---

## Test Fixtures

### Setup and Teardown

All integration tests should use `beforeEach`/`afterEach` hooks with proper cleanup:

```typescript
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { TestMortDirectory } from "../services/test-mort-directory.js";
import { TestRepository } from "../services/test-repository.js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

describe("skills integration tests", () => {
  let mortDir: TestMortDirectory;
  let repo: TestRepository;

  beforeEach(() => {
    // Initialize test directories
    mortDir = new TestMortDirectory().init();
    repo = new TestRepository({ fixture: "minimal" }).init();
    mortDir.registerRepository(repo);

    // Create skill fixtures programmatically
    createSkillFixture(mortDir.path, "test-mort", {
      name: "test-mort",
      description: "Test skill for Mort-specific functionality",
      content: "# Test Mort Skill\n\nArguments received: $ARGUMENTS",
    });
  });

  afterEach((context) => {
    // Preserve on failure for debugging
    const failed = context.task.result?.state === "fail";
    repo.cleanup(failed);
    mortDir.cleanup(failed);
  });
});

function createSkillFixture(
  mortPath: string,
  slug: string,
  options: { name: string; description: string; content: string; location?: string }
) {
  const location = options.location ?? "skills"; // skills | claude/skills | project/.claude/skills
  const skillDir = join(mortPath, location, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: ${options.name}
description: ${options.description}
---
${options.content}`
  );
}
```

### Fixture File Locations

For tests that need real filesystem fixtures, use these locations:

| Fixture Type | Directory | Description |
|--------------|-----------|-------------|
| Mort skills | `<tempDir>/skills/<slug>/SKILL.md` | Skills in ~/.mort/skills/ |
| Personal skills | `<tempDir>/claude/skills/<slug>/SKILL.md` | Skills in ~/.claude/skills/ |
| Project skills | `<repoPath>/.claude/skills/<slug>/SKILL.md` | Project-level skills |
| Legacy commands | `<tempDir>/claude/commands/<name>.md` | Legacy command files |

### Programmatic vs Manual Fixtures

**Programmatic (preferred for tests):**
- Use helper functions like `createSkillFixture()` above
- Allows dynamic test data
- Cleans up automatically via `TestMortDirectory`

**Manual fixtures (for static test data):**
- Create files in `agents/src/testing/fixtures/skills/`
- Copy to temp directory in `beforeEach`
- Use when exact file content must be version controlled

### Example Skill Fixtures

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

## Cross-Platform Testing

### Path Handling

Skills discovery and file operations must work correctly across platforms:

| Consideration | Implementation |
|---------------|----------------|
| Path separators | Use `path.join()` and `path.sep` instead of hardcoded `/` or `\\` |
| Home directory | Use `os.homedir()` or Tauri's `homeDir()` - never hardcode `~` |
| Case sensitivity | macOS/Windows filesystems may be case-insensitive; normalize skill slugs |

### Test Patterns for Cross-Platform

```typescript
import { join, sep } from "path";
import { homedir } from "os";

describe("path handling", () => {
  it("normalizes skill paths regardless of input separators", () => {
    // Test with both forward and back slashes
    const inputPath = "skills/my-skill/SKILL.md";
    const normalized = normalizePath(inputPath);
    expect(normalized).toBe(join("skills", "my-skill", "SKILL.md"));
  });

  it("handles home directory expansion", () => {
    const expanded = expandPath("~/.mort/skills");
    expect(expanded.startsWith(homedir())).toBe(true);
    expect(expanded).not.toContain("~");
  });
});
```

### Case Sensitivity

```typescript
describe("skill slug case handling", () => {
  it("treats skill slugs case-insensitively for lookups", () => {
    // On case-insensitive filesystems (macOS HFS+, Windows NTFS default),
    // "My-Skill" and "my-skill" refer to the same directory
    const skill1 = createSkillFixture(mortPath, "My-Skill", { ... });

    // Lookup should work with different casing
    const found = skillsService.getBySlug("my-skill");
    expect(found).toBeDefined();
    expect(found?.slug).toBe("my-skill"); // Normalized to lowercase
  });
});
```

### CI/CD Configuration Notes

Add to `.github/workflows/test.yml`:

```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test
```

**Windows-specific considerations:**
- Max path length (260 chars by default) - keep skill paths short
- Line endings (CRLF vs LF) - ensure SKILL.md files use LF
- File locking - tests should not hold file handles open

---

## Accessibility Testing

### Keyboard Navigation Requirements

The slash command dropdown and skill UI must be fully keyboard accessible:

| Action | Key(s) | Expected Behavior |
|--------|--------|-------------------|
| Open dropdown | `/` | Dropdown opens, first item focused |
| Navigate down | `ArrowDown` | Focus moves to next skill |
| Navigate up | `ArrowUp` | Focus moves to previous skill |
| Select skill | `Enter` | Skill inserted, dropdown closes |
| Close dropdown | `Escape` | Dropdown closes, focus returns to input |
| Navigate with filter | Type characters | List filters, selection preserved if still visible |

### Keyboard Navigation Tests

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("slash command keyboard navigation", () => {
  it("navigates dropdown with arrow keys", async () => {
    const user = userEvent.setup();
    render(<ChatInput />);

    const input = screen.getByRole("textbox");
    await user.type(input, "/");

    // Dropdown should open
    const dropdown = screen.getByRole("listbox");
    expect(dropdown).toBeVisible();

    // First item should be focused
    const items = screen.getAllByRole("option");
    expect(items[0]).toHaveFocus();

    // Arrow down moves to next
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    // Arrow up moves back
    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();

    // Enter selects
    await user.keyboard("{Enter}");
    expect(dropdown).not.toBeVisible();
    expect(input).toHaveValue("/test-skill ");
  });

  it("closes dropdown on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<ChatInput />);

    const input = screen.getByRole("textbox");
    await user.type(input, "/");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});
```

### Screen Reader Testing Approach

**ARIA Attributes Required:**

| Element | Required ARIA | Purpose |
|---------|---------------|---------|
| Dropdown | `role="listbox"`, `aria-label="Skills"` | Identify as list of options |
| Skill item | `role="option"`, `aria-selected` | Identify selectable items |
| Input | `aria-expanded`, `aria-controls`, `aria-activedescendant` | Link input to dropdown state |
| Skill chip | `role="button"`, `aria-expanded` | Expandable content indicator |

**Screen Reader Test Checklist:**

- [ ] VoiceOver (macOS): Dropdown announces "Skills list, N items"
- [ ] VoiceOver: Arrow navigation announces skill name and description
- [ ] VoiceOver: Selection announces "Selected [skill name]"
- [ ] NVDA (Windows): Same announcements as VoiceOver
- [ ] Skill chips announce their state (expanded/collapsed)

**Testing with @testing-library:**

```typescript
describe("accessibility", () => {
  it("has correct ARIA attributes on dropdown", async () => {
    const user = userEvent.setup();
    render(<ChatInput />);

    const input = screen.getByRole("textbox");
    await user.type(input, "/");

    // Check input attributes
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls");

    // Check dropdown
    const dropdown = screen.getByRole("listbox");
    expect(dropdown).toHaveAttribute("aria-label", "Skills");

    // Check items
    const items = screen.getAllByRole("option");
    expect(items[0]).toHaveAttribute("aria-selected", "true");
  });

  it("skill chip is accessible", () => {
    render(<SkillChip skill={testSkill} />);

    const chip = screen.getByRole("button");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(chip).toHaveAccessibleName(/test-skill/i);
  });
});
```

### axe-core Integration

Run automated accessibility audits:

```typescript
import { axe, toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

describe("accessibility audits", () => {
  it("slash command dropdown has no violations", async () => {
    const { container } = render(<ChatInputWithDropdown />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("skill chip has no violations", async () => {
    const { container } = render(<SkillChip skill={testSkill} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

---

## Race Condition Testing

### Concurrent Discovery Scenarios

Skills discovery can be triggered from multiple sources simultaneously:
- App startup
- User types `/` in input
- User opens settings
- File watcher detects changes

### Testing Concurrent Discovery

```typescript
describe("concurrent skill discovery", () => {
  it("handles multiple simultaneous discover() calls without duplicates", async () => {
    const store = useSkillsStore.getState();

    // Trigger multiple discoveries concurrently
    const promises = [
      skillsService.discover(),
      skillsService.discover(),
      skillsService.discover(),
    ];

    await Promise.all(promises);

    // Should not have duplicate skills
    const skills = store.skills;
    const slugs = skills.map(s => s.slug);
    const uniqueSlugs = [...new Set(slugs)];
    expect(slugs.length).toBe(uniqueSlugs.length);
  });

  it("returns consistent results under concurrent access", async () => {
    // Run discovery many times concurrently
    const iterations = 10;
    const results = await Promise.all(
      Array.from({ length: iterations }, () => skillsService.discover())
    );

    // All results should be identical
    const firstResult = JSON.stringify(results[0]);
    for (const result of results) {
      expect(JSON.stringify(result)).toBe(firstResult);
    }
  });

  it("does not corrupt store state during rapid updates", async () => {
    const store = useSkillsStore.getState();

    // Rapidly hydrate and read
    const operations = Array.from({ length: 100 }, (_, i) => async () => {
      const skills = [createTestSkill({ slug: `skill-${i}` })];
      store.hydrate(skills);
      return store.skills;
    });

    // Run all operations concurrently
    await Promise.all(operations.map(op => op()));

    // Store should be in consistent state (last write wins, but no corruption)
    const finalSkills = store.skills;
    expect(Array.isArray(finalSkills)).toBe(true);
    expect(finalSkills.every(s => s.slug && s.name)).toBe(true);
  });
});
```

### Assertions for "No Race Conditions"

What we verify to assert no race conditions:

1. **No duplicate entries**: Same skill slug never appears twice
2. **Consistent snapshots**: Multiple reads during concurrent writes return valid arrays
3. **No undefined/null corruption**: Store always contains valid skill objects
4. **Eventual consistency**: After all operations complete, store reflects final state

```typescript
describe("race condition assertions", () => {
  it("store remains valid during concurrent modifications", async () => {
    const store = useSkillsStore.getState();
    const errors: Error[] = [];

    // Concurrent reader that validates state
    const reader = setInterval(() => {
      try {
        const skills = store.skills;
        // Validate array structure
        expect(Array.isArray(skills)).toBe(true);
        // Validate each skill has required fields
        for (const skill of skills) {
          expect(skill).toHaveProperty("slug");
          expect(skill).toHaveProperty("name");
          expect(skill).toHaveProperty("source");
        }
      } catch (e) {
        errors.push(e as Error);
      }
    }, 1);

    // Concurrent writers
    const writers = Array.from({ length: 20 }, (_, i) =>
      skillsService.discover().catch(e => errors.push(e))
    );

    await Promise.all(writers);
    clearInterval(reader);

    // No errors should have occurred
    expect(errors).toHaveLength(0);
  });
});
```

### Debouncing Discovery

If race conditions become problematic, implement debouncing:

```typescript
// In skillsService
let discoveryPromise: Promise<Skill[]> | null = null;

export async function discover(): Promise<Skill[]> {
  // If discovery is already in progress, return the same promise
  if (discoveryPromise) {
    return discoveryPromise;
  }

  discoveryPromise = performDiscovery();

  try {
    return await discoveryPromise;
  } finally {
    discoveryPromise = null;
  }
}
```

Test the debouncing:

```typescript
it("deduplicates concurrent discovery calls", async () => {
  let callCount = 0;
  vi.spyOn(skillsService, "performDiscovery").mockImplementation(async () => {
    callCount++;
    await new Promise(r => setTimeout(r, 100));
    return [createTestSkill()];
  });

  // Fire 5 concurrent calls
  await Promise.all([
    skillsService.discover(),
    skillsService.discover(),
    skillsService.discover(),
    skillsService.discover(),
    skillsService.discover(),
  ]);

  // Should only call performDiscovery once
  expect(callCount).toBe(1);
});
```

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
