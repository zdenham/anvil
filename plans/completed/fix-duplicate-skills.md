# Fix Duplicate Skills in Settings

## Problem

The skills list in Settings shows duplicate entries. The root cause is a race condition in `SkillsService.discover()`.

### Race Condition in `SkillsService`

`SkillsService` is a singleton (`src/lib/skills-service-instance.ts`). Multiple callers invoke `discover()` concurrently:

1. **Settings page** — `useEffect` on mount (`skills-settings.tsx:52`)
2. **Skill trigger handler** — every time user types "/" (`skill-handler.ts:39`)
3. **Resync button** — manual refresh (`skills-settings.tsx:30`)

`discover()` mutates shared instance state (`this.skills`, `this.slugIndex`) across multiple `await` points. When two calls interleave:

1. **Call A** starts → `this.skills.clear()`, `this.slugIndex.clear()`
2. **Call A** processes "commit" → `slugIndex.has("commit")` → false → `await this.fs.readFile(...)` *(yields)*
3. **Call B** starts → `this.skills.clear()`, `this.slugIndex.clear()` ← **wipes Call A's progress**
4. **Call B** processes "commit" → `slugIndex.has("commit")` → false (cleared!) → `await this.fs.readFile(...)`
5. **Call A** resumes → `slugIndex.set("commit", id-A)`, `skills.set(id-A, {...})`
6. **Call B** resumes → `slugIndex.set("commit", id-B)`, `skills.set(id-B, {...})`

Result: `skills` Map has **two entries** for slug "commit" with different UUIDs. `getAll()` returns both.

The settings page then hydrates the store keyed by ID, so both duplicates make it through to the UI.

### Secondary issue: `processEntry` check-then-act gap

Even without concurrent `discover()` calls, `processEntry` has a TOCTOU gap:
- Line 106: `if (this.slugIndex.has(slug)) return;` — **check**
- Line 109: `await this.fs.readFile(skillPath);` — **yields to event loop**
- Line 116: `this.slugIndex.set(slug, id);` — **act**

Between check and act, another concurrent process could check the same slug and also pass.

## Phases

- [ ] Fix race condition in `SkillsService.discover()` using local Maps
- [ ] Add slug-based dedup safety net in store's `getAll()`
- [ ] Add unit test for concurrent discover calls

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

### Phase 1: Use local Maps in `discover()` (`core/lib/skills/skills-service.ts`)

Change `discover()` to build results in **local** Maps, then atomically assign them to instance fields at the end. This eliminates the race entirely — concurrent calls each build independent state and the last one to finish wins cleanly.

```typescript
async discover(repoPath: string, homeDir: string, anvilDataDir: string): Promise<SkillMetadata[]> {
  const localSkills = new Map<string, SkillMetadata>();
  const localSlugIndex = new Map<string, string>();

  for (const location of SKILL_LOCATIONS) {
    const dirPath = location.getPath(repoPath, homeDir, anvilDataDir);
    if (!await this.fs.exists(dirPath)) continue;

    try {
      const entries = await this.fs.listDirWithMetadata(dirPath);
      for (const entry of entries) {
        await this.processEntry(entry, location, dirPath, localSkills, localSlugIndex);
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  // Atomic swap — no partial state visible to other callers
  this.skills = localSkills;
  this.slugIndex = localSlugIndex;
  this.lastDiscoveryPath = repoPath;

  return this.getAll();
}
```

Update `processEntry` to accept the local Maps as parameters instead of using `this.skills` / `this.slugIndex`.

### Phase 2: Add slug dedup in store's `getAll()` (`src/entities/skills/store.ts`)

As a safety net, deduplicate by slug in the store selector, preferring higher-priority sources:

```typescript
getAll: () => {
  const seen = new Set<string>();
  return Object.values(get().skills)
    .filter(s => s.userInvocable)
    .sort((a, b) =>
      SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] ||
      a.name.localeCompare(b.name)
    )
    .filter(s => {
      if (seen.has(s.slug)) return false;
      seen.add(s.slug);
      return true;
    });
},
```

### Phase 3: Unit test

Add a test in `core/lib/__tests__/` that calls `discover()` concurrently on the same instance and asserts no duplicate slugs in the result.
