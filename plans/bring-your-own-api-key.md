# Bring Your Own API Key

Allow users to optionally provide their own Anthropic API key instead of using the hardcoded default.

## Current State

- `VITE_ANTHROPIC_API_KEY` is baked into the build (hardcoded key)
- `settings.anthropicApiKey` already exists in `WorkspaceSettings` (nullable string), persisted to `settings.json`
- `agent-service.ts` already resolves the key as: `settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY` (lines 716, 880)
- No UI exists for users to enter/manage their key
- `isConfigured()` currently requires `anthropicApiKey !== null` — but this is unused outside tests

**The backend plumbing already works.** The main work is adding a settings UI and fixing `isConfigured` so it doesn't require a user key when the built-in key exists.

## Phases

- [ ] Fix `isConfigured()` to not require user API key
- [ ] Add API Key settings UI component
- [ ] Add key validation feedback
- [ ] Update tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix `isConfigured()`

**File:** `src/entities/settings/store.ts`

Change `isConfigured()` to only check `repository !== null`. The API key always has a fallback (`VITE_ANTHROPIC_API_KEY`), so the app is "configured" once a repo is set.

```ts
isConfigured: () => {
  const { repository } = get().workspace;
  return repository !== null;
},
```

Update related tests in `src/entities/settings/settings.test.ts`.

## Phase 2: Add API Key Settings UI

**New file:** `src/components/main-window/settings/api-key-settings.tsx`

Create an `ApiKeySettings` component following the existing `SettingsSection` pattern:

- Password-type input field for the API key (masked by default, toggle to reveal)
- "Save" button that calls `settingsService.set("anthropicApiKey", value)`
- "Clear" button to remove custom key and revert to default (`settingsService.set("anthropicApiKey", null)`)
- Label indicating whether user is on custom key or built-in default
- The key should be shown as masked (`sk-ant-...XXXX`) when saved, full input when editing

**File:** `src/components/main-window/settings-page.tsx`

Add `<ApiKeySettings />` to the settings page, above Repository settings:

```tsx
<ApiKeySettings />
<RepositorySettings />
```

## Phase 3: Add Key Validation

In the `ApiKeySettings` component, after the user saves a key:

- Make a lightweight validation call (e.g., check the key format starts with `sk-ant-`)
- Show inline success/error feedback (green checkmark or red error text)
- If the key is invalid format, prevent saving and show an error
- Don't make an actual API call for validation — format check is sufficient

## Phase 4: Update Tests

**File:** `src/entities/settings/settings.test.ts`

- Update `isConfigured` tests to reflect new behavior (only checks repository)
- Add/update test for `getApiKey` returning null when no custom key set

No new test file needed for the UI component — it's a simple form with existing patterns.
