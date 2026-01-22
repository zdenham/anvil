# 03 - Plan Detection Service

**Dependencies:** 01-core-types
**Parallelizable with:** 02-store-service, 04-entity-relationships

## Design Decisions

- **Detection Scope**: Only detect `plans/*.md` files (case-sensitive)
- **Read Tool**: Reading a plan file does NOT trigger association
- **Write/Edit Tools**: Writing or editing a plan file DOES trigger association
- **Human Message**: Mentioning a plan path in a human message DOES trigger association
- **One Plan Per Thread**: First match wins; only one plan per thread (may expand to many-to-many later)
- **Case Sensitivity**: Detection is case-sensitive (`plans/` not `Plans/`)

## Overview

Create the detection logic that identifies when threads interact with plan files, enabling automatic plan-thread association.

## Implementation Steps

### 1. Create Detection Service

**File:** `src/entities/plans/detection-service.ts`

```typescript
import type { FileChange } from "@core/types/events";

const PLANS_DIRECTORY = "plans";
const PLAN_FILE_EXTENSION = ".md";

// Regex to match plan paths in user messages (case-sensitive)
const PLAN_PATH_REGEX = /plans\/[^\s]+\.md/g;

interface DetectionResult {
  detected: boolean;
  path: string | null;
}

/**
 * Detect if a tool call creates/edits a plan file
 * NOTE: Only Write and Edit tools trigger detection, NOT Read
 */
export function detectPlanFromToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  workingDirectory: string
): DetectionResult {
  // Only check Write and Edit tools - Reading does NOT trigger association
  if (toolName !== "Write" && toolName !== "Edit") {
    return { detected: false, path: null };
  }

  const filePath = toolInput.file_path as string | undefined;
  if (!filePath) {
    return { detected: false, path: null };
  }

  // Normalize path to be relative to working directory
  const relativePath = normalizeToRelativePath(filePath, workingDirectory);

  if (isPlanPath(relativePath)) {
    return { detected: true, path: relativePath };
  }

  return { detected: false, path: null };
}

/**
 * Detect plan paths mentioned in user message content
 * This DOES trigger association (per design decision)
 */
export function detectPlanFromMessage(messageContent: string): DetectionResult {
  const matches = messageContent.match(PLAN_PATH_REGEX);

  if (matches && matches.length > 0) {
    // Return the first match (one plan per thread for now)
    return { detected: true, path: matches[0] };
  }

  return { detected: false, path: null };
}

/**
 * Detect plans from file changes array (from AGENT_STATE events)
 * Uses FileChange[] structure with path, operation, etc.
 */
export function detectPlanFromFileChanges(
  fileChanges: FileChange[],
  workingDirectory: string
): DetectionResult {
  for (const change of fileChanges) {
    // Only detect creates and modifies, not deletes
    if (change.operation === "delete") {
      continue;
    }

    const relativePath = normalizeToRelativePath(change.path, workingDirectory);

    if (isPlanPath(relativePath)) {
      return { detected: true, path: relativePath };
    }
  }

  return { detected: false, path: null };
}

/**
 * Check if a path is a plan file (case-sensitive)
 * Only matches plans/*.md
 */
function isPlanPath(relativePath: string): boolean {
  // Must be in plans/ directory (case-sensitive)
  if (!relativePath.startsWith(`${PLANS_DIRECTORY}/`)) {
    return false;
  }

  // Must be a markdown file
  if (!relativePath.endsWith(PLAN_FILE_EXTENSION)) {
    return false;
  }

  return true;
}

/**
 * Normalize an absolute or relative path to be relative to working directory
 */
function normalizeToRelativePath(
  filePath: string,
  workingDirectory: string
): string {
  // If already relative, return as-is
  if (!filePath.startsWith("/")) {
    return filePath;
  }

  // Remove working directory prefix
  const normalizedWorkDir = workingDirectory.endsWith("/")
    ? workingDirectory
    : `${workingDirectory}/`;

  if (filePath.startsWith(normalizedWorkDir)) {
    return filePath.slice(normalizedWorkDir.length);
  }

  // If path doesn't start with working directory, return the basename portion
  // This handles edge cases where the path is absolute but in a different location
  return filePath;
}
```

### 2. Create Detection Hook for Thread Listener Integration

**File:** `src/entities/plans/use-plan-detection.ts`

```typescript
import { useCallback } from "react";
import { planService } from "./service";
import { useTaskStore } from "@/entities/tasks";
import {
  detectPlanFromToolCall,
  detectPlanFromFileChanges,
  detectPlanFromMessage,
} from "./detection-service";
import type { FileChange } from "@core/types/events";

interface UsePlanDetectionOptions {
  taskId: string;
  workingDirectory: string;
}

/**
 * Hook to detect and create plan associations
 * Note: repositoryName is looked up from task, not passed directly
 */
export function usePlanDetection({
  taskId,
  workingDirectory,
}: UsePlanDetectionOptions) {
  // Get repository name from task
  const task = useTaskStore((s) => s.tasks[taskId]);
  const repositoryName = task?.repositoryName;

  const detectFromToolCall = useCallback(
    async (
      toolName: string,
      toolInput: Record<string, unknown>
    ): Promise<string | null> => {
      if (!repositoryName) return null;

      const result = detectPlanFromToolCall(toolName, toolInput, workingDirectory);

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          repositoryName,
          result.path
        );
        return plan.id;
      }

      return null;
    },
    [repositoryName, workingDirectory]
  );

  const detectFromFileChanges = useCallback(
    async (fileChanges: FileChange[]): Promise<string | null> => {
      if (!repositoryName) return null;

      const result = detectPlanFromFileChanges(fileChanges, workingDirectory);

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          repositoryName,
          result.path
        );
        return plan.id;
      }

      return null;
    },
    [repositoryName, workingDirectory]
  );

  const detectFromMessage = useCallback(
    async (messageContent: string): Promise<string | null> => {
      if (!repositoryName) return null;

      const result = detectPlanFromMessage(messageContent);

      if (result.detected && result.path) {
        const plan = await planService.ensurePlanExists(
          repositoryName,
          result.path
        );
        return plan.id;
      }

      return null;
    },
    [repositoryName]
  );

  return {
    detectFromToolCall,
    detectFromFileChanges,
    detectFromMessage,
  };
}
```

### 3. Update Index to Export Detection

**File:** Update `src/entities/plans/index.ts`

```typescript
export * from "./types";
export * from "./store";
export { planService } from "./service";
export * from "./detection-service";
export { usePlanDetection } from "./use-plan-detection";
```

## Integration Notes

The actual integration into thread listeners will happen in `05-hydration.md`. This sub-plan only creates the detection logic.

Integration points for later:
- `AGENT_STATE` events with `state.fileChanges` array (note: fileChanges is inside `state`, not at top level)
- User message submission (check message content for plan paths)
- Tool permission requests (Write/Edit to plan files)

**Important:** The `FileChange` type from `@core/types/events` has this structure:
```typescript
{
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  oldPath?: string;
  diff: string;
}
```

## Validation Criteria

- [ ] `detectPlanFromToolCall` correctly identifies Write/Edit to plans/*.md
- [ ] `detectPlanFromToolCall` ignores Read tool calls
- [ ] `detectPlanFromMessage` correctly extracts plan paths from text
- [ ] `detectPlanFromFileChanges` correctly scans FileChange[] arrays
- [ ] `detectPlanFromFileChanges` ignores delete operations
- [ ] Detection is case-sensitive (plans/ not Plans/)
- [ ] Path normalization handles both absolute and relative paths
- [ ] Nested plan paths work (e.g., `plans/feature/sub-feature.md`)
- [ ] Non-markdown files in plans/ are ignored
- [ ] Hook correctly looks up repositoryName from task
- [ ] TypeScript compiles without errors
