# Fix: Settings page crash — `formatHotkeyDisplay` called with undefined

## Problem

Opening the settings page in the browser (non-Tauri) crashes with:
```
TypeError: Cannot read properties of undefined (reading 'split')
    at formatHotkeyDisplay (hotkey-formatting.ts:24)
```

Both `HotkeySettings` and `ClipboardHotkeySettings` crash.

## Root Cause

`src/lib/invoke.ts` line 72-73 defines browser fallback defaults:
```ts
get_saved_hotkey: null,
get_saved_clipboard_hotkey: null,
```

Both components do:
```ts
const [currentHotkey, setCurrentHotkey] = useState<string>("Command+Space");
useEffect(() => {
  getSavedHotkey().then(setCurrentHotkey).catch(console.error);
}, []);
```

The `null` return overwrites the default `"Command+Space"` state, then `formatHotkeyDisplay(null)` crashes on `.split()`.

## Fix

Two-layer defense:

### 1. Guard `formatHotkeyDisplay` (`src/utils/hotkey-formatting.ts:23`)

Add an early return for falsy input:
```ts
export const formatHotkeyDisplay = (hotkeyString: string): string => {
  if (!hotkeyString) return "";
  const parts = hotkeyString.split("+");
  // ...rest unchanged
};
```

### 2. Filter nullish results in both components

**`src/components/main-window/settings/hotkey-settings.tsx:14`**:
```ts
getSavedHotkey().then((h) => { if (h) setCurrentHotkey(h); }).catch(console.error);
```

**`src/components/main-window/settings/clipboard-hotkey-settings.tsx:14`**:
```ts
getSavedClipboardHotkey().then((h) => { if (h) setCurrentHotkey(h); }).catch(console.error);
```

## Phases

- [x] Add null guard to `formatHotkeyDisplay`
- [x] Fix `HotkeySettings` to ignore null results from `getSavedHotkey`
- [x] Fix `ClipboardHotkeySettings` to ignore null results from `getSavedClipboardHotkey`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Change

| File | Change |
|---|---|
| `src/utils/hotkey-formatting.ts` | Guard against falsy `hotkeyString` |
| `src/components/main-window/settings/hotkey-settings.tsx` | Only `setCurrentHotkey` if result is truthy |
| `src/components/main-window/settings/clipboard-hotkey-settings.tsx` | Only `setCurrentHotkey` if result is truthy |
