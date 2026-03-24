# Phase 5: anvil-test CLI Integration

## Goal

Add commands to the anvil-test CLI for testing the spotlight shortcut functionality independently of the main app.

## Prerequisites

- Phase 3 complete (spotlight_shortcut.rs with core logic)

## Output

**Modified File:** `src-tauri/src/bin/anvil-test/main.rs`

## Implementation

### Update anvil-test/main.rs

First, the anvil-test binary needs access to the spotlight_shortcut module. Since it's in the main crate, we need to make it accessible.

#### Option A: Use path attribute (simpler)

Add to `src-tauri/src/bin/anvil-test/main.rs`:

```rust
// At the top, include the modules from the parent crate
#[path = "../../accessibility.rs"]
mod accessibility;

#[path = "../../system_settings.rs"]
mod system_settings;

#[path = "../../spotlight_shortcut.rs"]
mod spotlight_shortcut;
```

#### Option B: Export from lib (cleaner)

In `src-tauri/src/lib.rs`, make the module public:

```rust
pub mod accessibility;
pub mod system_settings;
pub mod spotlight_shortcut;
```

Then in anvil-test, use:
```rust
use anvil::{accessibility, spotlight_shortcut};
```

### Add CLI Commands

Update the `Commands` enum in `src-tauri/src/bin/anvil-test/main.rs`:

```rust
#[derive(Subcommand)]
enum Commands {
    // ... existing commands ...

    /// Disable the system Spotlight keyboard shortcut
    DisableSpotlight {
        /// Check status only, don't modify
        #[arg(long)]
        dry_run: bool,

        /// Print the UI tree for debugging
        #[arg(long)]
        debug: bool,
    },

    /// Check if accessibility permission is granted
    CheckAccessibility,

    /// Request accessibility permission (opens System Settings)
    RequestAccessibility,
}
```

### Add Command Handlers

In the `main()` function, add handlers for the new commands:

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        // ... existing handlers ...

        Commands::DisableSpotlight { dry_run, debug } => {
            // Check permission first
            if !accessibility::is_accessibility_trusted() {
                eprintln!("Error: Accessibility permission not granted");
                eprintln!("Run: anvil-test request-accessibility");
                std::process::exit(1);
            }

            if debug {
                // Open settings and print tree for debugging
                eprintln!("Opening System Settings for debug...");
                let nav = system_settings::SystemSettingsNavigator::open_pane(
                    "x-apple.systempreferences:com.apple.preference.keyboard",
                    3000,
                )?;
                std::thread::sleep(std::time::Duration::from_millis(500));
                nav.debug_tree();
                nav.close();
                return Ok(());
            }

            if dry_run {
                let enabled = spotlight_shortcut::is_spotlight_shortcut_enabled()?;
                println!("{}", serde_json::json!({
                    "spotlight_shortcut_enabled": enabled
                }));
            } else {
                spotlight_shortcut::disable_spotlight_shortcut()?;
                eprintln!("Spotlight shortcut disabled successfully");
            }
        }

        Commands::CheckAccessibility => {
            let has_permission = accessibility::is_accessibility_trusted();
            println!("{}", serde_json::json!({
                "has_accessibility_permission": has_permission
            }));
            std::process::exit(if has_permission { 0 } else { 1 });
        }

        Commands::RequestAccessibility => {
            std::process::Command::new("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
                .spawn()?;
            eprintln!("Opened Accessibility settings");
            eprintln!("Grant permission to anvil-test, then try again");
        }
    }

    Ok(())
}
```

## Usage Examples

```bash
# Check if accessibility permission is granted
anvil-test check-accessibility
# Output: {"has_accessibility_permission": true}
# Exit code: 0 if granted, 1 if not

# Request accessibility permission (opens System Settings)
anvil-test request-accessibility

# Check if Spotlight shortcut is enabled (dry run)
anvil-test disable-spotlight --dry-run
# Output: {"spotlight_shortcut_enabled": true}

# Debug: print the System Settings UI tree
anvil-test disable-spotlight --debug

# Actually disable the Spotlight shortcut
anvil-test disable-spotlight
# Output: Spotlight shortcut disabled successfully
```

## Build and Test

```bash
# Build anvil-test
cargo build -p anvil --bin anvil-test

# Run it (from target directory or with cargo run)
cargo run -p anvil --bin anvil-test -- check-accessibility

# Or after building:
./target/debug/anvil-test check-accessibility
```

## Verification

1. Build: `cargo build -p anvil --bin anvil-test`
2. Run `anvil-test check-accessibility`
3. If needed, run `anvil-test request-accessibility` and grant permission
4. Run `anvil-test disable-spotlight --dry-run` to check status
5. Run `anvil-test disable-spotlight --debug` to see UI tree
6. Run `anvil-test disable-spotlight` to actually disable

## Success Criteria

- [ ] `anvil-test check-accessibility` reports permission status
- [ ] `anvil-test request-accessibility` opens the right Settings pane
- [ ] `anvil-test disable-spotlight --dry-run` returns current status
- [ ] `anvil-test disable-spotlight --debug` prints UI tree
- [ ] `anvil-test disable-spotlight` successfully disables the shortcut
- [ ] Clear error messages when permission is missing

## Notes

- The `--debug` flag is invaluable for discovering element names on different macOS versions
- Exit codes follow Unix convention: 0 for success/true, 1 for failure/false
- JSON output makes it easy to parse in scripts
- The CLI can be used for CI/CD testing once permissions are configured
