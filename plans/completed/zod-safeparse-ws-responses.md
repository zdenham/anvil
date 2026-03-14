# Zod safeParse for Corrupted WS Responses

## Problem

When the WebKit network process crashes under backpressure, in-flight WS responses arrive as garbage data. The filesystem client at `src/lib/filesystem-client.ts:116` uses throwing `.parse()`:

```typescript
return z.array(DirEntrySchema).parse(raw);
```

This throws a `ZodError` that becomes an unhandled rejection, contributing to the crash cascade. The Zod error is a **symptom** (corrupted data from a dying WS connection), not the root cause, but it should be handled gracefully.

## Approach

Switch from `.parse()` to `.safeParse()` at WS response boundaries in the filesystem client. Return sensible defaults or throw typed errors that callers can handle.

## Key Files

| File | Lines | Change |
|------|-------|--------|
| `src/lib/filesystem-client.ts` | 41, 116, 171 | Switch `.parse()` → `.safeParse()` with error logging |

## Phases

- [x] Replace all `.parse()` calls in `filesystem-client.ts` with `.safeParse()`, log parse failures with context (raw data preview, caller), return empty arrays on failure
- [x] Audit other IPC response boundaries for similar throwing `.parse()` calls and fix any found

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Pattern

```typescript
const result = z.array(DirEntrySchema).safeParse(raw);
if (!result.success) {
  logger.error("[filesystem-client] Failed to parse dir listing", {
    error: result.error.message,
    rawPreview: JSON.stringify(raw).slice(0, 200),
  });
  return []; // Graceful degradation — empty listing, UI shows "no files"
}
return result.data;
```

This prevents a corrupted WS response from cascading into an unhandled rejection while preserving diagnostic info for debugging.
