# Fix Skill Search Sorting by Relevance

## Problem

When typing `/` to search skills, results are not sorted by relevance. An exact match (e.g., typing "commit" when a skill named "commit" exists) can appear below less-relevant results because the list is only filtered, never re-sorted.

**Current behavior:** `search()` calls `getAll()` (sorted by source priority + alphabetical) then `.filter()` — preserving the original order regardless of match quality.

**Expected behavior:** Results should be sorted by match relevance: exact match > prefix match > substring match in name > match in description only.

## Files to Change

1. **`core/lib/skills/skills-service.ts`** — `search()` method (lines 165-171): add relevance scoring and sorting
2. **`src/entities/skills/store.ts`** — `search` selector (lines 56-63): mirror the same relevance sorting logic

## Phases

- [x] Implement relevance-scored search in `SkillsService.search()`
- [x] Mirror the same logic in the Zustand store's `search` selector
- [x] Add unit tests for search ranking

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Scoring function

Add a `scoreMatch(skill, query)` helper that returns a numeric score (lower = better match):

| Score | Condition |
|-------|-----------|
| 0 | Exact name/slug match |
| 1 | Name/slug starts with query |
| 2 | Name/slug contains query |
| 3 | Description contains query |
| Infinity | No match (filtered out) |

All comparisons are case-insensitive. When two skills have the same relevance score, fall back to the existing sort: source priority, then alphabetical name.

### Implementation in `SkillsService.search()`

```ts
search(query: string): SkillMetadata[] {
  const q = query.toLowerCase();
  return this.getAll()
    .map(s => ({ skill: s, score: scoreMatch(s, q) }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score)
    .map(({ skill }) => skill);
}
```

Since `getAll()` already returns results sorted by source priority + name, and JS `.sort()` is stable, skills with the same relevance score will maintain their existing order — no extra tie-breaking needed.

### Zustand store mirror

Apply the same `scoreMatch` logic in `src/entities/skills/store.ts`. To avoid duplication, extract `scoreMatch` into a small shared utility in `core/lib/skills/` and import it in both places.

### Tests

Add a test in `core/lib/skills/` that verifies:
- Exact match ranks first
- Prefix match ranks above substring match
- Substring-in-name ranks above description-only match
- Equal-score results preserve source priority + alphabetical order
