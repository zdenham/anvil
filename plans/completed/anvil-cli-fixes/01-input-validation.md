# Input Validation

**File:** `agents/src/cli/anvil.ts`
**Parallel:** Yes (no dependencies)

## Problem

- Invalid types silently default to "work"
- Invalid statuses accepted without error
- Empty `--tags=""` creates `[""]` instead of `[]`

## Solution

### Step 1: Add validation constants

```typescript
const VALID_TYPES = ["work", "investigate"] as const;
const VALID_STATUSES = ["draft", "backlog", "todo", "in-progress", "done",
                        "pending", "in_progress", "paused", "completed",
                        "merged", "cancelled"] as const;
```

### Step 2: Add validation functions

```typescript
function validateType(value: string): "work" | "investigate" {
  if (!VALID_TYPES.includes(value as any)) {
    error(`Invalid type "${value}". Must be: ${VALID_TYPES.join(", ")}`);
  }
  return value as "work" | "investigate";
}

function validateStatus(value: string): TaskStatus {
  if (!VALID_STATUSES.includes(value as any)) {
    error(`Invalid status "${value}". Must be: ${VALID_STATUSES.join(", ")}`);
  }
  return value as TaskStatus;
}

function parseTags(value: string): string[] {
  if (!value || value.trim() === "") return [];
  return value.split(",").map(t => t.trim()).filter(t => t.length > 0);
}
```

### Step 3: Apply validators in `tasksUpdate()`

Replace:
```typescript
const typeArg = getArg(args, "--type");
if (typeArg) updates.type = typeArg === "investigate" ? "investigate" : "work";
```

With:
```typescript
const typeArg = getArg(args, "--type");
if (typeArg) updates.type = validateType(typeArg);

const statusArg = getArg(args, "--status");
if (statusArg) updates.status = validateStatus(statusArg);

const tagsArg = getArg(args, "--tags");
if (tagsArg !== undefined) updates.tags = parseTags(tagsArg);
```

## Verification

```bash
anvil tasks update --id=xxx --type=invalid  # Should error
anvil tasks update --id=xxx --status=bad    # Should error
anvil tasks update --id=xxx --tags=""       # Should result in []
```
