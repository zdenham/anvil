# Zod Audit: Adapters and Contexts

Audit of `/src/adapters/` and `/src/contexts/` directories for Zod migration opportunities per the pattern documented in `docs/patterns/zod-boundaries.md`.

## Summary

**Total files reviewed:** 5

| Category | Count |
|----------|-------|
| Files correctly NOT using Zod | 4 |
| Files that SHOULD add Zod | 1 |
| Files incorrectly using Zod | 0 |

The adapters and contexts directories are mostly correct. The only issue is that `WorkspaceSettings` is loaded from disk (JSON file) but lacks Zod validation.

> **Cross-reference**: The `workspace-settings-service.ts` finding is also documented in `zod-audit-lib.md` which covers `src/lib/` comprehensively. This audit focuses on the context/adapter layers specifically.

## Detailed Findings

### `/src/adapters/tauri-fs-adapter.ts`

**Current state:** No Zod usage. Implements `FSAdapter` interface.

**Verdict:** CORRECT - No changes needed.

**Reasoning:** This is an adapter implementation (a class with methods). Per the pattern doc, adapter interfaces describe code structure, not data, so Zod is not appropriate here.

---

### `/src/contexts/global-error-context.tsx`

**Current state:** No Zod usage. Defines:
- `GlobalError` interface (message, stack)
- `GlobalErrorContextValue` interface (with methods)
- `GlobalErrorProviderProps` interface (React props)

**Verdict:** CORRECT - No changes needed.

**Reasoning:**
- `GlobalError` is internal state created by TypeScript code, not loaded from external sources
- `GlobalErrorContextValue` contains methods (showError, clearError) - interfaces with methods shouldn't use Zod
- `GlobalErrorProviderProps` is React component props - internal, compile-time checked

---

### `/src/contexts/workspace-settings-context.tsx`

**Current state:** No Zod usage. Defines:
- `WorkspaceSettingsContextValue` interface (with methods like `updateSetting`, `updateSettings`, `reload`)
- `WorkspaceSettingsProviderProps` interface (React props)

**Verdict:** CORRECT for this file - No changes needed.

**Reasoning:** Both interfaces contain methods or are React props, which are internal types. The context consumes `WorkspaceSettings` from the service layer, which is where validation should occur.

---

### `/src/contexts/index.ts`

**Current state:** No Zod usage. Re-exports from context files and the `WorkspaceSettings` type from the service.

**Verdict:** CORRECT - No changes needed.

**Reasoning:** This is purely a barrel file for re-exports. No data handling occurs here.

---

### `/src/lib/workspace-settings-service.ts`

**Current state:** No Zod usage. Defines:
- `WorkspaceSettings` interface (repository, anthropicApiKey)
- `DEFAULT_WORKSPACE_SETTINGS` constant

**Verdict:** SHOULD ADD ZOD - This is a trust boundary.

**Reasoning:** `WorkspaceSettings` is loaded from disk via `SettingsStoreClient.getOrDefault()` which reads from `settings/workspace.json`. The JSON file could be:
- Corrupted
- Manually edited with wrong types
- From an older schema version
- Missing expected fields

The current code uses a generic type parameter `<T>` with no runtime validation:
```typescript
// Current: No validation
return client.getOrDefault<WorkspaceSettings>(
  WORKSPACE_SETTINGS_KEY,
  DEFAULT_WORKSPACE_SETTINGS
);
```

### Recommended Change

**File:** `/src/lib/workspace-settings-service.ts`

**Key pattern**: Use `z.infer<typeof Schema>` to derive the type from the Zod schema. This eliminates redundant type definitions and ensures the runtime validation matches the TypeScript type.

```typescript
// BEFORE - Redundant type definition (interface duplicates what Zod would provide)
export interface WorkspaceSettings {
  repository: string | null;
  anthropicApiKey: string | null;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  repository: null,
  anthropicApiKey: null,
};

// getOrDefault trusts the JSON blindly via generic type parameter
return client.getOrDefault<WorkspaceSettings>(
  WORKSPACE_SETTINGS_KEY,
  DEFAULT_WORKSPACE_SETTINGS
);
```

```typescript
// AFTER - Schema is source of truth, type is derived
import { z } from "zod";
import { logger } from "./logger-client";

// Schema defines both runtime validation AND TypeScript type
const WorkspaceSettingsSchema = z.object({
  repository: z.string().nullable(),
  anthropicApiKey: z.string().nullable(),
});

// Type derived from schema - no redundant interface
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  repository: null,
  anthropicApiKey: null,
};

export const getWorkspaceSettings = async (): Promise<WorkspaceSettings> => {
  const client = getSettingsClient();
  await client.bootstrap();

  // Use unknown to force validation - don't trust the generic
  const raw = await client.get<unknown>(WORKSPACE_SETTINGS_KEY);

  if (raw === null) {
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  const result = WorkspaceSettingsSchema.safeParse(raw);
  if (!result.success) {
    // Log error with proper logger, return defaults for graceful degradation
    logger.error("Invalid workspace settings, using defaults:", result.error);
    return DEFAULT_WORKSPACE_SETTINGS;
  }

  return result.data;
};
```

**Note**: The `saveWorkspaceSettings` function doesn't need changes since we're writing TypeScript-created data that's already typed. Validation is only needed when _reading_ from disk.

## Related Files

The `SettingsStoreClient` at `/src/lib/settings-store-client.ts` uses generic `<T>` parameters without validation. A broader improvement would be to have the client accept an optional Zod schema for validation, but that's outside the scope of this specific audit.

## Files That Need Changes

| File | Action | Priority |
|------|--------|----------|
| `/src/lib/workspace-settings-service.ts` | Add Zod schema for WorkspaceSettings | Medium |

## Implementation Checklist

When implementing the `WorkspaceSettings` fix:

- [ ] Add `z` import from `zod`
- [ ] Replace `interface WorkspaceSettings` with `const WorkspaceSettingsSchema = z.object(...)`
- [ ] Change type export to `export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>`
- [ ] Update `getWorkspaceSettings` to use `safeParse` with graceful degradation
- [ ] Use `logger` instead of `console.error` per codebase conventions
- [ ] Verify `DEFAULT_WORKSPACE_SETTINGS` still type-checks (it should, as the type is now inferred)
- [ ] No changes needed to `saveWorkspaceSettings`

## Notes

The adapters directory is clean - the single file is an implementation class that correctly uses TypeScript interfaces for code structure (methods), not data.

The contexts directory correctly uses plain TypeScript interfaces for:
- React context values (which contain methods like `updateSetting`)
- Component props (internal, compile-time checked)

The one issue found is in the supporting `workspace-settings-service.ts` file, which loads data from disk without validation. While technically in `/src/lib/` rather than `/src/contexts/`, it's directly related to the workspace settings context and represents a real trust boundary violation.

## Key Principle: z.infer Eliminates Redundancy

When adding Zod validation, **do not** maintain a separate TypeScript interface alongside the schema:

```typescript
// BAD - Redundant, can drift out of sync
const WorkspaceSettingsSchema = z.object({
  repository: z.string().nullable(),
});
interface WorkspaceSettings {  // Duplicate definition!
  repository: string | null;
}

// GOOD - Single source of truth
const WorkspaceSettingsSchema = z.object({
  repository: z.string().nullable(),
});
type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;
```

This ensures the runtime validation and compile-time type can never drift apart.
