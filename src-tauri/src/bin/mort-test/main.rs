use clap::{Parser, Subcommand};
use std::time::Duration;

mod accessibility;
mod keyboard;

// Import spotlight/accessibility functions from the main mort crate
use mort_lib::accessibility::{
    is_accessibility_trusted,
    disable_spotlight_shortcut,
    is_spotlight_shortcut_enabled,
    SystemSettingsNavigator,
};

#[derive(Parser)]
#[command(name = "mort-test")]
#[command(about = "E2E testing CLI for Mortician using native macOS APIs")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Trigger a keyboard shortcut (e.g., "Command+Space")
    Trigger {
        /// The shortcut to trigger (e.g., "Command+Space", "Command+Option+C")
        shortcut: String,
    },

    /// Type text using synthetic keyboard events
    Type {
        /// The text to type
        text: String,
    },

    /// Send individual key presses
    Key {
        /// Keys to press (e.g., "ArrowDown", "Enter")
        keys: Vec<String>,
    },

    /// List visible Mortician windows
    Windows,

    /// Wait for a panel to become visible
    Wait {
        /// Panel name to wait for (e.g., "spotlight", "clipboard")
        panel: String,

        /// Wait for panel to be hidden instead of visible
        #[arg(long)]
        hidden: bool,

        /// Timeout in milliseconds
        #[arg(short, long, default_value = "5000")]
        timeout: u64,
    },

    /// Check if a panel is currently visible
    Check {
        /// Panel name to check
        panel: String,
    },

    /// Run a test scenario
    Scenario {
        /// Scenario name
        name: String,
    },

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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Trigger { shortcut } => {
            keyboard::trigger_shortcut(&shortcut)?;
            eprintln!("Triggered: {}", shortcut);
        }

        Commands::Type { text } => {
            keyboard::type_string(&text)?;
            eprintln!("Typed: {}", text);
        }

        Commands::Key { keys } => {
            for key in &keys {
                keyboard::trigger_shortcut(key)?;
                std::thread::sleep(Duration::from_millis(50));
            }
            eprintln!("Pressed: {:?}", keys);
        }

        Commands::Windows => {
            let windows = accessibility::get_mortician_windows();
            println!("{}", serde_json::to_string_pretty(&windows)?);
        }

        Commands::Wait {
            panel,
            hidden,
            timeout,
        } => {
            if hidden {
                accessibility::wait_for_panel_hidden(&panel, timeout)?;
                eprintln!("Panel hidden: {}", panel);
            } else {
                accessibility::wait_for_panel(&panel, timeout)?;
                eprintln!("Panel visible: {}", panel);
            }
        }

        Commands::Check { panel } => {
            let visible = accessibility::is_panel_visible(&panel);
            println!(
                "{}",
                serde_json::json!({ "panel": panel, "visible": visible })
            );
            std::process::exit(if visible { 0 } else { 1 });
        }

        Commands::Scenario { name } => {
            run_scenario(&name)?;
        }

        Commands::DisableSpotlight { dry_run, debug } => {
            // Check permission first
            if !is_accessibility_trusted() {
                eprintln!("Error: Accessibility permission not granted");
                eprintln!("Run: mort-test request-accessibility");
                std::process::exit(1);
            }

            if debug {
                // Open settings and print tree for debugging
                eprintln!("Opening System Settings for debug...");
                let nav = SystemSettingsNavigator::open_pane(
                    "x-apple.systempreferences:com.apple.preference.keyboard",
                    3000,
                )?;
                std::thread::sleep(std::time::Duration::from_millis(500));

                // Try to click Keyboard Shortcuts button
                let button_names = ["Keyboard Shortcuts…", "Keyboard Shortcuts...", "Keyboard Shortcuts"];
                for name in button_names {
                    if nav.find_button(name).is_some() {
                        eprintln!("Clicking button: {}", name);
                        let _ = nav.click_button(name);
                        std::thread::sleep(std::time::Duration::from_millis(1000));
                        break;
                    }
                }

                // Try to click Spotlight shortcuts in sidebar
                let spotlight_names = ["Spotlight shortcuts", "Spotlight"];
                for name in spotlight_names {
                    if nav.find_row(name).is_some() {
                        eprintln!("Clicking sidebar: {}", name);
                        let _ = nav.click_row(name);
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        break;
                    }
                }

                eprintln!("\n=== UI Tree after clicking Spotlight shortcuts ===");
                nav.debug_tree();
                nav.close();
                return Ok(());
            }

            if dry_run {
                let enabled = is_spotlight_shortcut_enabled()?;
                println!("{}", serde_json::json!({
                    "spotlight_shortcut_enabled": enabled
                }));
            } else {
                disable_spotlight_shortcut()?;
                eprintln!("Spotlight shortcut disabled successfully");
            }
        }

        Commands::CheckAccessibility => {
            let has_permission = is_accessibility_trusted();
            let app_path = std::env::current_exe().ok();

            println!("{}", serde_json::json!({
                "has_accessibility_permission": has_permission,
                "executable": app_path.map(|p| p.display().to_string()),
                "note": if !has_permission {
                    Some("Run 'mort-test request-accessibility' to grant permission")
                } else {
                    None
                }
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

fn run_scenario(name: &str) -> Result<(), Box<dyn std::error::Error>> {
    match name {
        "spotlight-search" => {
            // Open spotlight
            keyboard::trigger_shortcut("Command+Space")?;
            accessibility::wait_for_panel("spotlight", 2000)?;

            // Type query
            std::thread::sleep(Duration::from_millis(100));
            keyboard::type_string("cursor")?;

            // Navigate and select
            std::thread::sleep(Duration::from_millis(500));
            keyboard::trigger_shortcut("ArrowDown")?;
            keyboard::trigger_shortcut("Return")?;

            // Wait for panel to close
            accessibility::wait_for_panel_hidden("spotlight", 2000)?;

            eprintln!("Scenario complete: spotlight-search");
        }

        "clipboard-open" => {
            // Open clipboard panel
            keyboard::trigger_shortcut("Command+Option+C")?;
            accessibility::wait_for_panel("clipboard", 2000)?;

            eprintln!("Scenario complete: clipboard-open");
        }

        "clipboard-paste" => {
            // Open clipboard panel
            keyboard::trigger_shortcut("Command+Option+C")?;
            accessibility::wait_for_panel("clipboard", 2000)?;

            // Navigate and select
            std::thread::sleep(Duration::from_millis(100));
            keyboard::trigger_shortcut("ArrowDown")?;
            keyboard::trigger_shortcut("Return")?;

            // Wait for panel to close
            accessibility::wait_for_panel_hidden("clipboard", 2000)?;

            eprintln!("Scenario complete: clipboard-paste");
        }

        _ => {
            return Err(format!("Unknown scenario: {}", name).into());
        }
    }
    Ok(())
}
