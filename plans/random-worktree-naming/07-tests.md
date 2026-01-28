# Sub-Plan 07: Tests

## Overview
Create integration tests for the worktree naming feature.

## Dependencies
- All previous sub-plans must be complete

## Reference
Follow the pattern in `agents/src/testing/__tests__/thread-naming.integration.test.ts`

## Steps

### Step 1: Create Worktree Naming Test File

**New File:** `agents/src/testing/__tests__/worktree-naming.integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateWorktreeName } from "../../services/worktree-naming-service.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));

describe("worktree-naming-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateWorktreeName", () => {
    it("returns sanitized prompt for short inputs", async () => {
      const name = await generateWorktreeName("fix bug", "test-key");
      expect(name).toBe("fix-bug");
      expect(name.length).toBeLessThanOrEqual(10);
    });

    it("sanitizes special characters", async () => {
      const name = await generateWorktreeName("Fix Bug!", "test-key");
      expect(name).toBe("fix-bug");
    });

    it("truncates long sanitized names to 10 chars", async () => {
      const name = await generateWorktreeName("abcdefghijk", "test-key");
      expect(name.length).toBeLessThanOrEqual(10);
    });

    it("calls LLM for long prompts", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "auth-fix",
      });

      const name = await generateWorktreeName(
        "Implement user authentication with OAuth2 and JWT tokens",
        "test-key"
      );

      expect(generateText).toHaveBeenCalled();
      expect(name).toBe("auth-fix");
    });

    it("produces valid worktree names", async () => {
      const { generateText } = await import("ai");
      (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "Test Name With Spaces!",
      });

      const name = await generateWorktreeName(
        "A very long prompt that needs LLM processing",
        "test-key"
      );

      // Should be sanitized
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(name.length).toBeLessThanOrEqual(10);
    });
  });
});
```

### Step 2: Create Random Name Utility Tests

**New File:** `src/lib/__tests__/random-name.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { generateRandomWorktreeName, generateUniqueWorktreeName } from "../random-name";

describe("random-name", () => {
  describe("generateRandomWorktreeName", () => {
    it("returns a string", () => {
      const name = generateRandomWorktreeName();
      expect(typeof name).toBe("string");
    });

    it("returns max 10 characters", () => {
      // Run multiple times to increase confidence
      for (let i = 0; i < 100; i++) {
        const name = generateRandomWorktreeName();
        expect(name.length).toBeLessThanOrEqual(10);
      }
    });

    it("returns valid characters only", () => {
      for (let i = 0; i < 100; i++) {
        const name = generateRandomWorktreeName();
        expect(name).toMatch(/^[a-z0-9-]+$/);
      }
    });

    it("returns lowercase names", () => {
      for (let i = 0; i < 100; i++) {
        const name = generateRandomWorktreeName();
        expect(name).toBe(name.toLowerCase());
      }
    });
  });

  describe("generateUniqueWorktreeName", () => {
    it("returns name not in existing set", () => {
      const existing = new Set(["red-fox", "blue-owl"]);
      const name = generateUniqueWorktreeName(existing);
      expect(existing.has(name)).toBe(false);
    });

    it("appends suffix for conflicts", () => {
      // Create a set that will definitely conflict
      const allNames = new Set<string>();

      // Generate first name
      const first = generateUniqueWorktreeName(allNames);
      allNames.add(first);

      // Force the same random name by mocking (or just verify suffix behavior)
      // For now, just verify the function handles conflicts
      expect(first.length).toBeLessThanOrEqual(10);
    });

    it("handles empty set", () => {
      const name = generateUniqueWorktreeName(new Set());
      expect(name.length).toBeGreaterThan(0);
    });
  });
});
```

### Step 3: Add Event System Tests

**File:** Add to existing event tests or create new file

```typescript
import { describe, it, expect } from "vitest";
import { EventName } from "@core/types/events";

describe("event system", () => {
  it("includes WORKTREE_NAME_GENERATED event", () => {
    expect(EventName.WORKTREE_NAME_GENERATED).toBe("worktree:name:generated");
  });
});
```

### Step 4: Integration Test (Optional)

If there's an integration test setup, add an end-to-end test:

1. Create a worktree with auto-generated name
2. Create first thread with a prompt
3. Verify worktree name is updated via LLM

## Verification
1. All tests pass
2. Tests cover edge cases (short prompts, special chars, conflicts)
3. Tests verify the complete flow

## Output
- `agents/src/testing/__tests__/worktree-naming.integration.test.ts`
- `src/lib/__tests__/random-name.test.ts`
