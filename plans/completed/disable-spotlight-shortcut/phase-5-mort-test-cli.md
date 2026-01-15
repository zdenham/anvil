# Phase 5: mort-test CLI Integration

## Goal

Add commands to the mort-test CLI for testing the spotlight shortcut functionality independently of the main app.

## Prerequisites

- Phase 3 complete (spotlight_shortcut.rs with core logic)

## Output

**Modified File:** `src-tauri/src/bin/mort-test/main.rs`

## Implementation

### Update mort-test/main.rs

First, the mort-test binary needs access to the spotlight_shortcut module. Since it's in the main crate, we need to make it accessible.

#### Option A: Use path attribute (simpler)

Add to `src-tauri/src/bin/mort-test/main.rs`:

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

Then in mort-test, use:
```rust
use mortician::{accessibility, spotlight_shortcut};
```

### Add CLI Commands

Update the `Commands` enum in `src-tauri/src/bin/mort-test/main.rs`:

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
                eprintln!("Run: mort-test request-accessibility");
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
            eprintln!("Grant permission to mort-test, then try again");
        }
    }

    Ok(())
}
```

## Usage Examples

```bash
# Check if accessibility permission is granted
mort-test check-accessibility
# Output: {"has_accessibility_permission": true}
# Exit code: 0 if granted, 1 if not

# Request accessibility permission (opens System Settings)
mort-test request-accessibility

# Check if Spotlight shortcut is enabled (dry run)
mort-test disable-spotlight --dry-run
# Output: {"spotlight_shortcut_enabled": true}

# Debug: print the System Settings UI tree
mort-test disable-spotlight --debug

# Actually disable the Spotlight shortcut
mort-test disable-spotlight
# Output: Spotlight shortcut disabled successfully
```

## Build and Test

```bash
# Build mort-test
cargo build -p mortician --bin mort-test

# Run it (from target directory or with cargo run)
cargo run -p mortician --bin mort-test -- check-accessibility

# Or after building:
./target/debug/mort-test check-accessibility
```

## Verification

1. Build: `cargo build -p mortician --bin mort-test`
2. Run `mort-test check-accessibility`
3. If needed, run `mort-test request-accessibility` and grant permission
4. Run `mort-test disable-spotlight --dry-run` to check status
5. Run `mort-test disable-spotlight --debug` to see UI tree
6. Run `mort-test disable-spotlight` to actually disable

## Success Criteria

- [ ] `mort-test check-accessibility` reports permission status
- [ ] `mort-test request-accessibility` opens the right Settings pane
- [ ] `mort-test disable-spotlight --dry-run` returns current status
- [ ] `mort-test disable-spotlight --debug` prints UI tree
- [ ] `mort-test disable-spotlight` successfully disables the shortcut
- [ ] Clear error messages when permission is missing

## Notes

- The `--debug` flag is invaluable for discovering element names on different macOS versions
- Exit codes follow Unix convention: 0 for success/true, 1 for failure/false
- JSON output makes it easy to parse in scripts
- The CLI can be used for CI/CD testing once permissions are configured
