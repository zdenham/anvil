# Fix: `reviewDecision` empty string from gh CLI breaks Zod parse

## Phases

- [x] Fix the Zod schema to handle empty string from gh CLI
- [x] Remove diagnostic logging added for this bug
- [x] Update tests that construct mock PullRequestDetails

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Diagnosis (proven)

**Root cause:** GitHub's `gh pr view --json reviewDecision` returns an **empty string `""`** when no review decision exists (e.g., no reviewers assigned, no reviews submitted). The Zod schema only accepts `null` or the three valid enum values.

**Proof:** Running the actual command against PR #5 (`zdenham/mortician`):

```
$ gh pr view 5 --json reviewDecision
{"reviewDecision":""}
```

The `GhPrViewSchema` in `pr-schemas.ts` defines:

```ts
reviewDecision: z
  .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
  .nullable()
  .default(null),
```

Zod's `.nullable()` only accepts `null`, not `""`. The empty string is an "Invalid option" for the enum, causing the `ZodError`.

## Fix

### File: `src/lib/gh-cli/pr-schemas.ts` (line 17-20)

Use `.transform()` to coerce empty strings to `null` before the enum check. This keeps the downstream type unchanged (`"APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null`).

**Before:**
```ts
reviewDecision: z
  .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
  .nullable()
  .default(null),
```

**After:**
```ts
reviewDecision: z
  .union([
    z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]),
    z.literal(""),
  ])
  .nullable()
  .default(null)
  .transform((v) => (v === "" ? null : v)),
```

This accepts `null`, `""`, or a valid enum value. The `.transform()` normalizes `""` to `null`, so the inferred output type is still `"APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null`.

### File: `src/lib/gh-cli/pr-queries.ts` (lines 76-85)

Remove the diagnostic logging block that was added to investigate this bug. It's no longer needed.

### No changes needed downstream

- `core/types/pull-request.ts` — `PullRequestDetails.reviewDecision` is already typed as `... | null`. No change needed.
- `src/utils/pr-status.ts` — compares against `"CHANGES_REQUESTED"`, works fine with `null`.
- `src/components/content-pane/pr-reviews-section.tsx` — `DecisionIndicator` already returns `null` when `!decision`. An empty string would be falsy anyway, but after the fix it arrives as `null`.
- Test files that use `reviewDecision: null` in mocks are already correct.
