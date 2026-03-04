# Foundation: Types and Event Definitions

Shared types and events that both frontend and agent tracks depend on. Must complete before either parallel track starts.

## Phases

- [x] Create comment types and disk schema
- [x] Add comment event definitions

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Types and Disk Schema

**Files:**
- `core/types/comments.ts` (new)
- `core/types/index.ts` (modify) — add barrel re-export

```typescript
// core/types/comments.ts
import { z } from "zod";

export const InlineCommentSchema = z.object({
  id: z.string().uuid(),
  worktreeId: z.string().uuid(),
  threadId: z.string().uuid().nullable(), // null when left on standalone worktree diff
  filePath: z.string(),                   // relative path within worktree
  lineNumber: z.number().int(),           // resolved line number (see Line Number Resolution below)
  lineType: z.enum(["addition", "deletion", "unchanged"]),
  content: z.string().min(1),
  resolved: z.boolean().default(false),
  resolvedAt: z.number().nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type InlineComment = z.infer<typeof InlineCommentSchema>;

export const CommentsFileSchema = z.object({
  version: z.literal(1),
  comments: z.array(InlineCommentSchema),
});
export type CommentsFile = z.infer<typeof CommentsFileSchema>;
```

Add barrel re-export to `core/types/index.ts` (alongside the existing re-exports for threads, events, plans, etc.):

```typescript
// Comments - inline diff comment annotations
export * from "./comments.js";
```

**Notes:**
- `threadId` uses `.nullable()` instead of `.optional()` — nullable is more explicit for a field that's always present but may be null, and matches the disk format where the key is always written
- `resolvedAt` uses `.nullable().default(null)` instead of `.optional()` — same reasoning, always present in JSON

### Line Number Resolution

`AnnotatedLine.newLineNumber` and `oldLineNumber` are both `number | null`. When creating a comment, resolve the line number as:

```typescript
const lineNumber = line.newLineNumber ?? line.oldLineNumber;
// Skip lines where both are null (should not happen in practice)
if (lineNumber === null) return;
```

For deletions, `newLineNumber` is null so we fall back to `oldLineNumber`. For additions, `oldLineNumber` is null so `newLineNumber` is used. For unchanged lines, both are present and we prefer `newLineNumber`.

**Disk format:** `~/.mort/comments/{worktreeId}.json` (relative to `appData` root)

```json
{
  "version": 1,
  "comments": [
    {
      "id": "uuid",
      "worktreeId": "uuid",
      "threadId": null,
      "filePath": "src/foo.ts",
      "lineNumber": 42,
      "lineType": "addition",
      "content": "This should use a Map instead of an object",
      "resolved": false,
      "resolvedAt": null,
      "createdAt": 1708900000000,
      "updatedAt": 1708900000000
    }
  ]
}
```

---

## Phase 2: Event Definitions

**Files:**
- `core/types/events.ts` (modify)

Add to `EventName` object:

```typescript
// Comments
COMMENT_ADDED: "comment:added",
COMMENT_UPDATED: "comment:updated",
COMMENT_RESOLVED: "comment:resolved",
COMMENT_DELETED: "comment:deleted",
```

Add to `EventPayloads` interface:

```typescript
[EventName.COMMENT_ADDED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_UPDATED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_RESOLVED]: { worktreeId: string; commentId: string };
[EventName.COMMENT_DELETED]: { worktreeId: string; commentId: string };
```

Add to `EventNameSchema` enum array:

```typescript
EventName.COMMENT_ADDED,
EventName.COMMENT_UPDATED,
EventName.COMMENT_RESOLVED,
EventName.COMMENT_DELETED,
```

Event payloads are intentionally minimal (just IDs) per the event bridge pattern — events are signals, not data carriers. Listeners refresh from disk.

---

## Verification

After completing both phases:
1. `core/types/comments.ts` exists with `InlineCommentSchema`, `CommentsFileSchema`, and their inferred types
2. `core/types/events.ts` has all four `COMMENT_*` event names, payloads, and schema entries
3. TypeScript compiles cleanly from project root: `pnpm tsc --noEmit` and `pnpm --filter agents typecheck`
   (`core/` is not a standalone package — it's included via tsconfig paths in both frontend and agents)
