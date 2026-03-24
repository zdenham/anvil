# Deferred Shell Initialization After Documents Permission

## Overview

Move the login shell PATH capture (currently disabled) to run AFTER the user explicitly grants Documents permission via the permissions UI. This prevents the jarring Documents permission popup on first launch.

## Problem

Running a login shell at startup (`/bin/zsh -l -c "echo $PATH"`) sources user's shell config files which may reference `~/Documents`, triggering the macOS Documents permission prompt before the app UI even renders. This is poor UX.

## Solution

Defer shell initialization until after the user explicitly initiates it by clicking a "Grant Documents Access" link in the permissions UI - similar to how accessibility permissions work.

## User Flow

```
App Start
    ↓
paths::initialize() with static PATH fallback
    ↓
[App renders UI normally]
    ↓
User sees "Documents Access" in permissions UI
    ↓
User clicks "Grant Documents Access ↗"
    ↓
App runs login shell → macOS shows Documents permission prompt
    ↓
User grants permission → shell completes → PATH captured
    ↓
App continues with full shell PATH
```

## Implementation Steps

### Step 1: Backend - Add deferred shell initialization command

**File: `src-tauri/src/paths.rs`**

Add a new function and expose it as a Tauri command:

```rust
use std::sync::atomic::{AtomicBool, Ordering};

static SHELL_PATH_INITIALIZED: AtomicBool = AtomicBool::new(false);

/// Run the login shell to capture the user's PATH.
/// This may trigger macOS Documents permission prompt if shell configs access ~/Documents.
/// Returns true if a valid PATH was captured from the shell.
pub fn run_login_shell_initialization() -> bool {
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    if let Ok(output) = Command::new(&shell).args(["-l", "-c", "echo $PATH"]).output() {
        if output.status.success() {
            if let Ok(path) = String::from_utf8(output.stdout) {
                let path = path.trim();
                if !path.is_empty() {
                    // Update the shell path - need interior mutability or different approach
                    tracing::info!(shell = %shell, "Captured PATH from login shell");
                    SHELL_PATH_INITIALIZED.store(true, Ordering::SeqCst);
                    return true;
                }
            }
        }
    }

    tracing::warn!(shell = %shell, "Failed to capture PATH from login shell");
    false
}
```

**File: `src-tauri/src/lib.rs`**

Add a new Tauri command:

```rust
#[tauri::command]
fn initialize_shell_environment() -> Result<bool, String> {
    Ok(crate::paths::run_login_shell_initialization())
}
```

Register in the invoke handler:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    initialize_shell_environment,
])
```

### Step 2: Backend - Modify paths initialization

**File: `src-tauri/src/paths.rs`**

Change `capture_shell_path()` to return the static fallback by default:

```rust
fn capture_shell_path() -> String {
    // Start with static PATH fallback - login shell will be run later via Documents permission UI
    let current = env::var("PATH").unwrap_or_default();
    format!("{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin", current)
}
```

Add a mechanism to update SHELL_PATH after initialization:

```rust
use std::sync::RwLock;

static SHELL_PATH: OnceLock<RwLock<String>> = OnceLock::new();

/// Update the shell PATH after login shell initialization
pub fn set_shell_path(path: String) {
    if let Some(lock) = SHELL_PATH.get() {
        if let Ok(mut guard) = lock.write() {
            *guard = path;
        }
    }
}

/// Returns the shell PATH to use for external commands (git, etc.)
pub fn shell_path() -> String {
    SHELL_PATH
        .get()
        .expect("paths::initialize() not called")
        .read()
        .map(|s| s.clone())
        .unwrap_or_default()
}
```

### Step 3: Frontend - Add Tauri command wrapper

**File: `src/lib/tauri-commands.ts`**

Add command for shell initialization:

```typescript
export const shellCommands = {
  initializeShellEnvironment: async (): Promise<boolean> => {
    return invoke<boolean>("initialize_shell_environment");
  },
};
```

### Step 4: Frontend - Update PermissionsContent component

**File: `src/components/permissions/PermissionsContent.tsx`**

Add Documents permission support:

```typescript
interface PermissionsContentProps {
  // Existing
  accessibilityGranted: boolean;
  isCheckingAccessibility: boolean;
  onRequestAccessibility: () => void;
  onSkip?: () => void;
  // New for Documents
  documentsInitialized?: boolean;
  isInitializingDocuments?: boolean;
  onRequestDocuments?: () => void;
}

export const PermissionsContent = ({
  accessibilityGranted,
  isCheckingAccessibility,
  onRequestAccessibility,
  onSkip,
  documentsInitialized = true, // Default to true for backwards compat
  isInitializingDocuments = false,
  onRequestDocuments,
}: PermissionsContentProps) => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-surface-100 font-mono">
        Permissions
      </h2>
      <p className="text-surface-300">
        Anvil needs a few permissions to work at full capacity.
      </p>

      <div className="space-y-4">
        {/* Documents Access - FIRST */}
        {onRequestDocuments && (
          <div className="flex items-center gap-3">
            {documentsInitialized ? (
              <>
                <span className="text-green-400 font-mono">✓</span>
                <span className="text-surface-200 font-medium">
                  Documents Access initialized
                </span>
              </>
            ) : (
              <>
                <span className="text-surface-400 font-mono">•</span>
                <button
                  onClick={onRequestDocuments}
                  disabled={isInitializingDocuments}
                  className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                >
                  {isInitializingDocuments ? "Initializing..." : "Grant Documents Access ↗"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Accessibility Access */}
        <div className="flex items-center gap-3">
          {accessibilityGranted ? (
            <>
              <span className="text-green-400 font-mono">✓</span>
              <span className="text-surface-200 font-medium">
                Accessibility Access granted
              </span>
            </>
          ) : (
            <>
              <span className="text-surface-400 font-mono">•</span>
              <button
                onClick={onRequestAccessibility}
                disabled={isCheckingAccessibility}
                className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {isCheckingAccessibility ? "Requesting..." : "Grant Accessibility Access ↗"}
              </button>
            </>
          )}
        </div>
      </div>

      {!accessibilityGranted && onSkip && (
        <button
          onClick={onSkip}
          className="text-surface-500 hover:text-surface-300 underline decoration-dotted underline-offset-4 text-sm transition-colors"
        >
          Skip for now
        </button>
      )}
    </div>
  );
};
```

### Step 5: Frontend - Update PermissionsStep (onboarding)

**File: `src/components/onboarding/steps/PermissionsStep.tsx`**

Add Documents permission handling:

```typescript
import { shellCommands, spotlightShortcutCommands } from "@/lib/tauri-commands";

export const PermissionsStep = ({ onComplete, onSkip }: Props) => {
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);

  // New Documents state
  const [documentsInitialized, setDocumentsInitialized] = useState(false);
  const [isInitializingDocuments, setIsInitializingDocuments] = useState(false);

  const handleRequestDocuments = useCallback(async () => {
    setIsInitializingDocuments(true);
    try {
      // This runs the login shell, which may trigger Documents permission prompt
      const success = await shellCommands.initializeShellEnvironment();
      setDocumentsInitialized(true); // Mark as done regardless (user saw prompt if needed)
    } catch (error) {
      console.error("Failed to initialize shell environment:", error);
      setDocumentsInitialized(true); // Still mark as done - we tried
    } finally {
      setIsInitializingDocuments(false);
    }
  }, []);

  // ... existing accessibility logic

  return (
    <PermissionsContent
      documentsInitialized={documentsInitialized}
      isInitializingDocuments={isInitializingDocuments}
      onRequestDocuments={handleRequestDocuments}
      accessibilityGranted={accessibilityGranted}
      isCheckingAccessibility={isCheckingAccessibility}
      onRequestAccessibility={handleRequestAccessibility}
      onSkip={onSkip}
    />
  );
};
```

### Step 6: Frontend - Update PermissionsPrompt (returning users)

**File: `src/components/PermissionsPrompt.tsx`**

Add the same Documents permission handling as PermissionsStep.

### Step 7: Persist Documents initialization state

**Option A: Store in app config**

Add a flag to app config to track whether shell initialization has been run:

```typescript
// In config or settings
{
  "shellEnvironmentInitialized": true
}
```

**Option B: Check at startup**

On app start, check if we have a "real" shell PATH (longer than fallback) to determine if initialization was run.

**Recommendation**: Option A is cleaner - explicit state tracking.

## Files to Modify

| File | Action |
|------|--------|
| `src-tauri/src/paths.rs` | Add `run_login_shell_initialization()`, modify `capture_shell_path()` |
| `src-tauri/src/lib.rs` | Add `initialize_shell_environment` command |
| `src/lib/tauri-commands.ts` | Add `shellCommands.initializeShellEnvironment()` |
| `src/components/permissions/PermissionsContent.tsx` | Add Documents permission UI |
| `src/components/onboarding/steps/PermissionsStep.tsx` | Add Documents handling |
| `src/components/PermissionsPrompt.tsx` | Add Documents handling |

## Testing

1. **Fresh install flow**
   - Launch app → no Documents permission prompt on startup
   - User sees "Grant Documents Access" in permissions UI
   - Click link → Documents permission prompt appears (if shell config accesses Documents)
   - Grant permission → shell PATH captured, checkmark appears
   - Continue through onboarding

2. **Returning user flow**
   - User who skipped Documents permission previously
   - Launch app → PermissionsPrompt shows Documents option
   - Same flow as above

3. **No Documents access needed**
   - User whose shell config doesn't access ~/Documents
   - Clicking "Grant Documents Access" runs shell silently (no prompt)
   - Still captures PATH, marks as complete

4. **Denied permission**
   - User denies Documents permission when prompted
   - Shell command may fail or return partial PATH
   - App continues with fallback PATH
   - User can retry later

## Notes

- Unlike Accessibility, there's no macOS API to check if we have Documents permission
- The "Grant Documents Access" action runs the shell initialization which MAY trigger the prompt
- We mark it as "done" regardless of outcome - the user saw the prompt if their shell config needs it
- Consider adding explanatory text: "Your shell configuration may need Documents access"
