# Plan: Fix TypeScript Type Errors

**Status: COMPLETED**

## Overview

The TypeScript build was failing with multiple type errors across several files. The issues fell into three categories:

1. **JSX in `.ts` file** - `render.ts` contained JSX but had wrong extension
2. **Missing imports** - `simple-task-window.tsx` was missing `useEffect` and `threadService`
3. **Type mismatches** - Test helpers using `jest.Mock` instead of Vitest's `Mock`
4. **Unused imports** - Several files had unused type/value imports

## Fixes Applied

### 1. Rename `render.ts` to `render.tsx`

The file contained JSX syntax (React fragments and components) but had a `.ts` extension. TypeScript requires `.tsx` for JSX files.

```bash
git mv src/test/helpers/render.ts src/test/helpers/render.tsx
```

### 2. Add missing imports in `simple-task-window.tsx`

```typescript
import { useEffect } from "react";
import { threadService } from "@/entities/threads/service";
```

### 3. Fix Vitest types in `event-emitter.ts`

Changed `jest.Mock` to Vitest's `Mock` type:

```typescript
// Before
static spy<E extends keyof AppEvents>(eventName: E): jest.Mock<void, [AppEvents[E]]>

// After
import { vi, type Mock } from "vitest";
static spy<E extends keyof AppEvents>(eventName: E): Mock<(payload: AppEvents[E]) => void>
```

### 4. Add `expect` import in `queries.ts`

```typescript
import { expect } from "vitest";
```

### 5. Remove unused imports

| File | Removed |
|------|---------|
| `core/adapters/node/path-lock.test.ts` | `vi` |
| `core/services/__tests__/resolution-service.test.ts` | `beforeEach` |
| `core/services/repository/settings-service.ts` | `WorktreeClaimSchema` |
| `core/types/events.ts` | `MessageParam` |
| `src/components/simple-task/use-simple-task-params.ts` | `PendingSimpleTask` type alias |
| `src/components/spotlight/spotlight.tsx` | `AppResult` |
| `src/entities/threads/service.ts` | `ThreadState` |

## Verification

```bash
npx tsc --noEmit  # Passes with no errors
```
