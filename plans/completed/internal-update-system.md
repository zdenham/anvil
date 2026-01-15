# Internal Update System

## Overview

Add an "Update" button in the Settings page that triggers an internal distribution update by running the remote installation script in the background. The script downloads and installs the latest version, then quits and restarts the app.

## Requirements

1. Button should be in the About section alongside the version display
2. Script must run backgrounded (`&`) because it will quit and restart the app
3. Use the existing internal distribution script URL:
   ```
   https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/distribute_internally.sh
   ```

## Implementation Steps

### Step 1: Add Rust Command for Background Script Execution

Add to `src-tauri/src/shell.rs`:

```rust
/// Runs the internal update script in the background.
/// The script downloads a new version and restarts the app, so it must be detached.
#[tauri::command]
pub fn run_internal_update() -> Result<(), String> {
    use std::process::Stdio;

    let script_url = "https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/distribute_internally.sh";

    // Use sh -c to run the pipeline, with & to background the entire operation
    // The script will quit and restart the app, so we don't wait for it
    std::process::Command::new("sh")
        .args(["-c", &format!("curl -sL {} | bash &", script_url)])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start update: {}", e))?;

    tracing::info!("Internal update script started in background");
    Ok(())
}
```

### Step 2: Register Command in lib.rs

Add to the `invoke_handler` in `src-tauri/src/lib.rs`:

```rust
shell::run_internal_update,
```

### Step 3: Add TypeScript Command Wrapper

Add to `src/lib/tauri-commands.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// Update Commands
// ═══════════════════════════════════════════════════════════════════════════

export const updateCommands = {
  /**
   * Run the internal update script in the background.
   * The script downloads a new version and restarts the app.
   */
  runInternalUpdate: () => invoke<void>("run_internal_update"),
};
```

### Step 4: Update AboutSettings Component

Modify `src/components/main-window/settings/about-settings.tsx`:

```typescript
import { Info, Download, Loader2 } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsSection } from "../settings-section";
import { updateCommands } from "@/lib/tauri-commands";
import { logger } from "@/lib/logger-client";

export function AboutSettings() {
  const [version, setVersion] = useState<string>("0.1.0");
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(logger.error);
  }, []);

  const handleUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      await updateCommands.runInternalUpdate();
      // Script runs in background and will restart the app
      // Keep the loading state since we expect the app to quit
    } catch (error) {
      logger.error("Update failed:", error);
      setIsUpdating(false);
    }
  }, []);

  return (
    <SettingsSection title="About">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-surface-400">
          <Info size={16} />
          <span>Mortician v{version}</span>
        </div>
        <button
          onClick={handleUpdate}
          disabled={isUpdating}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-surface-100 bg-surface-700 hover:bg-surface-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
        >
          {isUpdating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Updating...</span>
            </>
          ) : (
            <>
              <Download size={14} />
              <span>Update</span>
            </>
          )}
        </button>
      </div>
    </SettingsSection>
  );
}
```

## Files to Modify

| File                                                     | Action                            |
| -------------------------------------------------------- | --------------------------------- |
| `src-tauri/src/shell.rs`                                 | Add `run_internal_update` command |
| `src-tauri/src/lib.rs`                                   | Register the new command          |
| `src/lib/tauri-commands.ts`                              | Add TypeScript wrapper            |
| `src/components/main-window/settings/about-settings.tsx` | Add update button UI              |

## Testing

1. **Manual test**: Click the Update button

   - Button should show "Updating..." with spinner
   - App should quit and relaunch with new version
   - Verify new version number in About section

2. **Error handling test**: Disconnect network and click Update
   - Button should return to normal state on failure
   - Error should be logged

## Notes

- The update process intentionally does not show a confirmation dialog since this is for internal distribution only
- The script runs completely backgrounded so the Tauri process can exit cleanly when the script replaces it
- No progress indication is possible since the script runs detached
- If update fails silently (network error during download), the app will remain running at the current version
