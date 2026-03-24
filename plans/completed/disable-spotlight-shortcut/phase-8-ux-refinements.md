# Phase 8: UX Refinements for Spotlight Disable Step

This plan addresses feedback items to improve the user experience of the auto-disable spotlight feature.

## Changes Overview

1. **Kill System Settings and refocus Anvil window after success**
2. **Conditionally show manual steps behind a "Show manual steps" link**
3. **Add accessibility API disclaimer to the quick option card**
4. **5 second timeout with Promise.race for the auto-disable operation**
5. **Remove the "Great your hotkey should work perfectly now" success message**

---

## Implementation Steps

### Step 1: Add Tauri commands for cleanup (Rust)

**File:** `src-tauri/src/lib.rs`

Add two new Tauri commands:

```rust
#[tauri::command]
async fn kill_system_settings() -> Result<(), String> {
    use std::process::Command;
    Command::new("pkill")
        .args(["-x", "System Settings"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn focus_anvil_window(window: tauri::Window) -> Result<(), String> {
    window.set_focus().map_err(|e| e.to_string())
}
```

Register the commands in the builder.

### Step 2: Update SpotlightStep UI component

**File:** `src/components/onboarding/steps/SpotlightStep.tsx`

#### 2a. Add state for manual steps visibility

```typescript
const [showManualSteps, setShowManualSteps] = useState(false);
```

#### 2b. Update handleAutoDisable with 5 second timeout

```typescript
const handleAutoDisable = async () => {
  setStatus('disabling');
  setError(null);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), 5000);
  });

  try {
    await Promise.race([
      invoke('disable_system_spotlight_shortcut'),
      timeoutPromise
    ]);

    // Cleanup: kill System Settings and refocus Anvil
    await invoke('kill_system_settings');
    await invoke('focus_anvil_window');

    setStatus('success');
  } catch (err) {
    setStatus('error');
    // ... existing error handling, but auto-show manual steps on error
    setShowManualSteps(true);
    // ... rest of error handling
  }
};
```

#### 2c. Add disclaimer to quick option card

Inside the auto-disable card, add below the button:

```tsx
<p className="text-xs text-surface-500 mt-3">
  This uses accessibility APIs to change Spotlight settings in System Preferences.
</p>
```

#### 2d. Make manual steps collapsible

Replace the always-visible manual instructions with:

```tsx
{/* Manual steps toggle */}
{status !== 'success' && (
  <button
    onClick={() => setShowManualSteps(!showManualSteps)}
    className="text-sm text-surface-400 hover:text-surface-300 underline decoration-dotted underline-offset-4 transition-colors"
  >
    {showManualSteps ? 'Hide manual steps' : 'Show manual steps'}
  </button>
)}

{/* Manual instructions (collapsible) */}
{showManualSteps && (
  <div className="bg-surface-800 border border-surface-700 rounded-lg p-4 space-y-4">
    {/* existing manual steps content */}
  </div>
)}
```

#### 2e. Remove success message

Delete this entire block:

```tsx
{status === 'success' && (
  <div className="p-3 bg-green-900/20 border border-green-700/30 rounded-lg">
    <p className="text-sm text-green-300">
      Great! Your hotkey should work perfectly now.
    </p>
  </div>
)}
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Add `kill_system_settings` and `focus_anvil_window` commands |
| `src/components/onboarding/steps/SpotlightStep.tsx` | Timeout, collapsible manual steps, disclaimer, remove success text |

---

## Expected Behavior

1. User clicks "Auto-disable Spotlight Shortcut"
2. Operation runs with 5 second timeout (Promise.race)
3. **On success:**
   - System Settings is killed via `pkill`
   - Anvil window is refocused
   - Success checkmark shown inline (no extra success card)
4. **On timeout/error:**
   - Error message shown
   - Manual steps automatically revealed
   - User can retry or follow manual steps

---

## Testing

1. Test auto-disable completes within 5 seconds
2. Test timeout triggers after 5 seconds if operation hangs
3. Verify System Settings closes after success
4. Verify Anvil window regains focus
5. Verify manual steps hidden by default, shown on "Show manual steps" click
6. Verify manual steps auto-show on error
7. Verify disclaimer text appears in quick option card
8. Verify no "Great! Your hotkey should work perfectly now" text appears
