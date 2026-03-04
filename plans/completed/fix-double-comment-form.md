# Fix: Double Comment Form on Edited Diff Lines

## Problem

When a line is **edited** in a diff, it renders as two rows: a deletion (old) and an addition (new). Both rows can compute to the same `lineNumber` because:

- **Deletion row**: `oldLineNumber=5, newLineNumber=null` → `lineNumber = 5`
- **Addition row**: `oldLineNumber=null, newLineNumber=5` → `lineNumber = 5`

The state `activeCommentLine` is just a `number`, so setting it to `5` matches **both** rows via `activeCommentLine === lineNumber`, popping open two comment forms.

The same collision affects `commentsByLine` — stored comments on deletion-line-5 and addition-line-5 display on both rows.

## Root Cause

`diff-file-card.tsx:356` computes a single `lineNumber` that's ambiguous when old and new sides share the same number:

```ts
const lineNumber = item.line.newLineNumber ?? item.line.oldLineNumber ?? 0;
```

And `activeCommentLine` (line 304) and `commentsByLine` (line 326) both key by this bare number.

## Phases

- [x] Add composite key to disambiguate line + side in the UI
- [x] Thread side context through the comment click/display flow
- [x] Update agent prompt to include version context

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Composite key for line identity

The minimal change: use a `"lineNumber:lineType"` composite key to disambiguate.

### `diff-file-card.tsx` — `DiffLinesWithComments`

1. Change `activeCommentLine` from `number | null` to `string | null`
2. Introduce a helper to build the composite key:
   ```ts
   function lineKey(line: AnnotatedLine): string {
     const num = line.newLineNumber ?? line.oldLineNumber ?? 0;
     return `${num}:${line.type}`;
   }
   ```
3. Update `commentsByLine` to key by `"${lineNumber}:${lineType}"` instead of bare `lineNumber`:
   ```ts
   const commentsByLine = useMemo(() => {
     const map = new Map<string, InlineComment[]>();
     for (const c of comments) {
       const key = `${c.lineNumber}:${c.lineType}`;
       const existing = map.get(key) ?? [];
       existing.push(c);
       map.set(key, existing);
     }
     return map;
   }, [comments]);
   ```
4. In the render loop, use `lineKey(item.line)` for both `activeCommentLine` comparison and `commentsByLine` lookup:
   ```ts
   const key = lineKey(item.line);
   const lineComments = commentsByLine.get(key) ?? [];
   // ...
   {activeCommentLine === key && ( <InlineCommentForm ... /> )}
   ```

### `annotated-line-row.tsx` — `AnnotatedLineRow`

5. Change `onLineClick` prop from `(lineNumber: number) => void` to `(lineKey: string) => void`
6. Pass `lineKey(line)` instead of bare `lineNumber` in click/keyboard handlers and `CommentGutterButton`

### `comment-gutter-button.tsx`

7. Update `lineNumber` prop to `lineKey: string` (used only for the `onClick` callback and aria-label)

## Phase 2: Thread side context through the flow

This is mainly about making sure the InlineCommentForm and InlineCommentDisplay receive the right data.

### `inline-comment-form.tsx`

Already receives `lineNumber` and `lineType` as separate props — no change needed. The stored `InlineComment` already records `lineType`, so the composite key lookup works when the comment is later loaded from disk.

### `diff-file-card.tsx` render loop

The form props are already correct:
```tsx
<InlineCommentForm
  filePath={filePath}
  lineNumber={lineNumber}  // derived from line.newLineNumber ?? line.oldLineNumber
  lineType={item.line.type}
  onClose={...}
/>
```

No changes needed here — the `lineNumber` and `lineType` are still passed individually to the form. The composite key is only used for the **matching/keying** logic.

## Phase 3: Update agent prompt to include version context

Both `address-comments-button.tsx` and `floating-address-button.tsx` have a `formatAddressPrompt()` that generates the message sent to the agent. Currently:

```
## path/to/file.ts:42 (comment-id: abc-123)
> Fix this variable name
```

Change to include which version of the line the comment targets:

```
## path/to/file.ts:42 [added line] (comment-id: abc-123)
> Fix this variable name

## path/to/file.ts:10 [deleted line] (comment-id: def-456)
> This removal breaks the API
```

For `unchanged` lines, omit the bracket (it's unambiguous).

### Changes

In both files, update `formatAddressPrompt`:

```ts
function formatLineRef(c: InlineComment): string {
  const tag = c.lineType === "addition" ? " [added line]"
            : c.lineType === "deletion" ? " [deleted line]"
            : "";
  return `${c.filePath}:${c.lineNumber}${tag}`;
}

const sections = comments.map(
  (c) => `## ${formatLineRef(c)} (comment-id: ${c.id})\n> ${c.content}`,
);
```

This gives the agent the context it needs to know whether the comment is about the old or new version of the code.

## Files Changed

| File | Change |
|------|--------|
| `src/components/diff-viewer/diff-file-card.tsx` | Composite key for `activeCommentLine` + `commentsByLine` |
| `src/components/diff-viewer/annotated-line-row.tsx` | `onLineClick` passes composite key |
| `src/components/diff-viewer/comment-gutter-button.tsx` | Prop rename `lineNumber` → `lineKey` |
| `src/components/diff-viewer/address-comments-button.tsx` | `formatAddressPrompt` includes line type |
| `src/components/diff-viewer/floating-address-button.tsx` | `formatAddressPrompt` includes line type |

## No Schema Changes

`core/types/comments.ts` already stores `lineType` and the correct `lineNumber` for that side. The `InlineComment` model is fine — the bug is purely in the UI matching logic.
