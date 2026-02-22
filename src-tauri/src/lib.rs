#[cfg(target_os = "macos")]
pub mod accessibility;

// Make public for mort-test CLI access
#[cfg(target_os = "macos")]
pub use accessibility::{is_accessibility_trusted, check_accessibility_with_prompt};
#[cfg(target_os = "macos")]
pub use accessibility::{disable_spotlight_shortcut, is_spotlight_shortcut_enabled};
#[cfg(target_os = "macos")]
pub use accessibility::SystemSettingsNavigator;
mod agent_hub;
#[path = "app-search.rs"]
mod app_search;
mod build_info;
mod clipboard;
mod clipboard_db;
mod config;
mod file_watcher;
mod filesystem;
mod git_commands;
mod icons;
mod identity;
mod logging;
mod mort_commands;
mod panels;
mod paths;
mod process_commands;
mod profiling;
mod repo_commands;
mod shell;
mod terminal;
mod thread_commands;
mod worktree_commands;


#[cfg(target_os = "macos")]
mod menu;

#[cfg(target_os = "macos")]
mod tray;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use agent_hub::AgentHub;
use terminal::TerminalState;

const MAIN_WINDOW_LABEL: &str = "main";


/// Enables the fullscreen button (green traffic light) on macOS for the given window
#[cfg(target_os = "macos")]
fn enable_fullscreen_button(window: &tauri::WebviewWindow) {
    use raw_window_handle::HasWindowHandle;

    if let Ok(handle) = window.window_handle() {
        if let raw_window_handle::RawWindowHandle::AppKit(appkit_handle) = handle.as_raw() {
            use objc2::rc::Retained;
            use objc2_app_kit::{NSView, NSWindowCollectionBehavior};

            // Safety: the pointer is valid for the lifetime of the window
            let ns_view: Retained<NSView> =
                unsafe { Retained::retain(appkit_handle.ns_view.as_ptr().cast()) }
                    .expect("Failed to retain NSView");

            // Get the window from the view and enable fullscreen
            if let Some(ns_window) = ns_view.window() {
                let current = ns_window.collectionBehavior();
                let new_behavior = current | NSWindowCollectionBehavior::FullScreenPrimary;
                ns_window.setCollectionBehavior(new_behavior);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn enable_fullscreen_button(_window: &tauri::WebviewWindow) {
    // No-op on non-macOS platforms
}

/// Run TypeScript migrations by spawning Node.js process.
/// Returns Ok(()) on success, Err on failure (but failures should not block app startup).
fn run_ts_migrations(app: &tauri::App) -> Result<(), String> {
    use std::process::Command;
    use tauri::Manager;

    let data_dir = paths::data_dir();

    // Resolve paths from bundled resources
    // In development, use source paths; in production, use bundled resources
    let is_dev = cfg!(debug_assertions);

    let (runner_path, template_dir, sdk_types_path) = if is_dev {
        // Development: use source directories
        // Get the project root (parent of src-tauri)
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let project_root = std::path::Path::new(manifest_dir).parent().unwrap();

        (
            project_root.join("migrations/dist/runner.js"),
            project_root.join("core/sdk/template"),
            project_root.join("core/sdk/dist/index.d.ts"),
        )
    } else {
        // Production: resolve from bundled resources
        let runner = app.path()
            .resolve("_up_/migrations/dist/runner.js", tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("Failed to resolve migration runner: {}", e))?;
        let template = app.path()
            .resolve("_up_/core/sdk/template", tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("Failed to resolve SDK template: {}", e))?;
        let types = app.path()
            .resolve("sdk-types.d.ts", tauri::path::BaseDirectory::Resource)
            .map_err(|e| format!("Failed to resolve SDK types: {}", e))?;

        (runner, template, types)
    };

    tracing::info!(
        runner = %runner_path.display(),
        template = %template_dir.display(),
        types = %sdk_types_path.display(),
        data_dir = %data_dir.display(),
        is_dev = is_dev,
        "Running TypeScript migrations"
    );

    // Check if runner exists
    if !runner_path.exists() {
        return Err(format!("Migration runner not found at: {}", runner_path.display()));
    }

    let output = Command::new("node")
        .arg(&runner_path)
        .env("MORT_DATA_DIR", data_dir)
        .env("MORT_TEMPLATE_DIR", &template_dir)
        .env("MORT_SDK_TYPES_PATH", &sdk_types_path)
        .env("PATH", paths::shell_path())
        .output()
        .map_err(|e| format!("Failed to spawn migration runner: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(stderr = %stderr, "Migration runner failed");
        return Err(format!("Migration failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    tracing::info!(stdout = %stdout, "TypeScript migrations complete");
    Ok(())
}

/// Ensures essential .mort directories exist synchronously
fn ensure_mort_directories() -> Result<(), String> {
    let settings_dir = paths::settings_dir();
    let databases_dir = paths::databases_dir();

    std::fs::create_dir_all(&settings_dir)
        .map_err(|e| format!("Failed to create settings dir: {}", e))?;
    std::fs::create_dir_all(&databases_dir)
        .map_err(|e| format!("Failed to create databases dir: {}", e))?;

    tracing::info!(
        settings_dir = %settings_dir.display(),
        databases_dir = %databases_dir.display(),
        "Essential .mort directories ensured"
    );

    Ok(())
}

/// Receives log messages from the web frontend and routes them through the centralized logger
#[tauri::command]
fn web_log(level: &str, message: &str, source: Option<&str>) {
    logging::log_from_web(level, message, source.unwrap_or("web"));
}

/// Sends a message to a connected agent via the AgentHub socket.
#[tauri::command]
fn send_to_agent(
    state: tauri::State<'_, Arc<AgentHub>>,
    thread_id: String,
    message: String,
) -> Result<(), String> {
    state.send_to_agent(&thread_id, &message)
}

/// Lists all currently connected agents.
#[tauri::command]
fn list_connected_agents(state: tauri::State<'_, Arc<AgentHub>>) -> Vec<String> {
    state.list_connected_agents()
}

/// Gets the socket path for agent connections.
#[tauri::command]
fn get_agent_socket_path(state: tauri::State<'_, Arc<AgentHub>>) -> String {
    state.socket_path().to_string()
}

/// Registers a global hotkey that shows the spotlight window when triggered.
/// Re-registers the clipboard hotkey to preserve it.
#[tauri::command]
fn register_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    register_hotkey_internal(&app, &hotkey)
}

/// Internal function to register the spotlight hotkey
fn register_hotkey_internal(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    tracing::info!(
        hotkey = %hotkey,
        hotkey_len = hotkey.len(),
        hotkey_bytes = ?hotkey.as_bytes(),
        "register_hotkey_internal: received hotkey input"
    );

    // Unregister all existing shortcuts first
    tracing::info!("register_hotkey_internal: unregistering all existing shortcuts");
    let _ = app.global_shortcut().unregister_all();

    // Parse the spotlight hotkey string into a Shortcut
    tracing::info!(
        hotkey = %hotkey,
        "register_hotkey_internal: parsing hotkey string into Shortcut"
    );
    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| {
            tracing::error!(
                hotkey = %hotkey,
                error = ?e,
                "register_hotkey_internal: failed to parse hotkey"
            );
            format!("Failed to parse hotkey '{}': {:?}", hotkey, e)
        })?;

    tracing::info!(
        shortcut = ?shortcut,
        "register_hotkey_internal: parsed shortcut successfully"
    );

    // Clone app handle for the spotlight closure
    let app_handle = app.clone();

    // Register the spotlight shortcut
    tracing::info!("register_hotkey_internal: registering spotlight shortcut with global_shortcut");
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_spotlight(&app_handle);
            }
        })
        .map_err(|e| {
            tracing::error!(
                hotkey = %hotkey,
                error = ?e,
                "register_hotkey_internal: failed to register spotlight shortcut"
            );
            format!("Failed to register hotkey: {:?}", e)
        })?;

    tracing::info!(hotkey = %hotkey, "register_hotkey_internal: spotlight hotkey registered successfully");

    // Re-register the clipboard hotkey since unregister_all removed it
    let clipboard_hotkey = config::get_clipboard_hotkey();
    let clipboard_shortcut: Shortcut = clipboard_hotkey
        .parse()
        .map_err(|e| format!("Failed to parse clipboard hotkey: {:?}", e))?;
    let clipboard_app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(clipboard_shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                clipboard::toggle_clipboard_manager(&clipboard_app_handle);
            }
        })
        .map_err(|e| format!("Failed to re-register clipboard hotkey: {:?}", e))?;

    Ok(())
}

/// Saves the spotlight hotkey to config and registers it
#[tauri::command]
fn save_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    tracing::info!(
        hotkey = %hotkey,
        hotkey_len = hotkey.len(),
        hotkey_bytes = ?hotkey.as_bytes(),
        "save_hotkey: received hotkey from frontend"
    );

    tracing::info!("save_hotkey: calling config::set_spotlight_hotkey");
    config::set_spotlight_hotkey(&hotkey)?;
    tracing::info!("save_hotkey: config saved, calling register_hotkey_internal");

    let result = register_hotkey_internal(&app, &hotkey);
    tracing::info!(success = result.is_ok(), "save_hotkey: completed");
    result
}

/// Gets the saved spotlight hotkey from config
#[tauri::command]
fn get_saved_hotkey() -> String {
    config::get_spotlight_hotkey()
}

/// Saves the clipboard hotkey to config and re-registers hotkeys
#[tauri::command]
fn save_clipboard_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    config::set_clipboard_hotkey(&hotkey)?;
    let spotlight_hotkey = config::get_spotlight_hotkey();
    register_hotkey_internal(&app, &spotlight_hotkey)
}

/// Gets the saved clipboard hotkey from config
#[tauri::command]
fn get_saved_clipboard_hotkey() -> String {
    config::get_clipboard_hotkey()
}

/// Checks if the user has completed onboarding
#[tauri::command]
fn is_onboarded() -> bool {
    config::is_onboarded()
}

/// Marks onboarding as complete
#[tauri::command]
fn complete_onboarding() -> Result<(), String> {
    config::set_onboarded(true)
}

/// Shows the main settings/onboarding window
#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    use tauri::ActivationPolicy;

    tracing::info!("show_main_window called");

    // Temporarily set activation policy to Regular so the app can come to front
    let _ = app.set_activation_policy(ActivationPolicy::Regular);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        tracing::info!("Found main window, showing and focusing");
        window.show().map_err(|e| {
            tracing::error!(error = %e, "Failed to show main window");
            e.to_string()
        })?;
        window.set_focus().map_err(|e| {
            tracing::error!(error = %e, "Failed to focus main window");
            e.to_string()
        })?;
        tracing::info!("Main window shown and focused");
    } else {
        // Window was destroyed - recreate it
        tracing::info!("Main window not found, recreating...");
        let app_for_nav = app.clone();
        let window = tauri::WebviewWindowBuilder::new(
            &app,
            MAIN_WINDOW_LABEL,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Mort")
        .inner_size(600.0, 500.0)
        .resizable(true)
        .on_navigation(move |url| panels::is_allowed_navigation(&url, &app_for_nav))
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to recreate main window");
            e.to_string()
        })?;

        // Enable macOS fullscreen button for the recreated window
        enable_fullscreen_button(&window);

        window.show().map_err(|e| {
            tracing::error!(error = %e, "Failed to show recreated main window");
            e.to_string()
        })?;
        window.set_focus().map_err(|e| {
            tracing::error!(error = %e, "Failed to focus recreated main window");
            e.to_string()
        })?;
        tracing::info!("Main window recreated, shown, and focused");
    }
    Ok(())
}

/// Shows the main window and sets its content pane view.
/// Used for spotlight → main window navigation (Enter without Shift).
#[tauri::command]
fn show_main_window_with_view(app: AppHandle, view: serde_json::Value) -> Result<(), String> {
    use tauri::ActivationPolicy;

    tracing::info!("[MainWindow] show_main_window_with_view called: {:?}", view);

    // Temporarily set activation policy to Regular so the app can come to front
    let _ = app.set_activation_policy(ActivationPolicy::Regular);

    // Get the main window
    let window = app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("Main window not found")?;

    // Show and focus the main window
    window.show().map_err(|e| {
        tracing::error!(error = %e, "Failed to show main window");
        e.to_string()
    })?;
    window.set_focus().map_err(|e| {
        tracing::error!(error = %e, "Failed to focus main window");
        e.to_string()
    })?;

    // Emit event TO main window specifically to set the content pane view
    window.emit("set-content-pane-view", &view)
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to emit set-content-pane-view event");
            e.to_string()
        })?;

    tracing::info!("[MainWindow] Main window shown with view");
    Ok(())
}

/// Hides the main settings/onboarding window
#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
    use tauri::ActivationPolicy;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }

    // Revert to Accessory mode when main window is hidden
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);

    Ok(())
}

/// Opens the control panel for a specific thread
/// If prompt is provided, shows optimistic UI with the prompt text before task loads
/// NOTE: This must be synchronous (not async) because NSPanel operations require main thread
#[tauri::command]
fn open_control_panel(
    app: AppHandle,
    thread_id: String,
    task_id: String,
    prompt: Option<String>,
) -> Result<(), String> {
    panels::show_control_panel(&app, &thread_id, &task_id, prompt.as_deref())
}

/// Hides the control panel
#[tauri::command]
fn hide_control_panel(app: AppHandle) -> Result<(), String> {
    panels::hide_control_panel(&app)
}

/// Shows the control panel without setting thread context.
/// The view will be set via eventBus from the frontend.
#[tauri::command]
fn show_control_panel(app: AppHandle) -> Result<(), String> {
    panels::show_control_panel_simple(&app)
}

/// Shows the control panel with a specific view (thread, plan, or inbox).
/// Emits the open-control-panel event to the control panel window via Rust,
/// ensuring it crosses the window boundary (unlike JS eventBus which stays local).
#[tauri::command]
fn show_control_panel_with_view(app: AppHandle, view: serde_json::Value) -> Result<(), String> {
    tracing::info!("[ControlPanel] show_control_panel_with_view called: {:?}", view);

    // Emit event to control panel window
    // NOTE: Must use emit() not emit_to() - emit_to() doesn't work with NSPanels
    let payload = serde_json::json!({ "view": view });
    let _ = app.emit("open-control-panel", &payload);

    // Show the panel
    panels::show_control_panel_simple(&app)
}

/// Forces focus on the control panel if it's visible
#[tauri::command]
fn focus_control_panel(app: AppHandle) -> Result<(), String> {
    panels::focus_control_panel(&app)
}

/// Pins the control panel (prevents hide on blur during drag/resize)
#[tauri::command]
fn pin_control_panel() {
    panels::pin_control_panel()
}

/// Checks if a specific panel is visible
#[tauri::command]
fn is_panel_visible(app: AppHandle, panel_label: String) -> bool {
    panels::is_panel_visible(&app, &panel_label)
}

/// Shows the error panel with the given message and optional stack trace
#[tauri::command]
fn show_error_panel(app: AppHandle, message: String, stack: Option<String>) -> Result<(), String> {
    panels::show_error(&app, &message, stack.as_deref())
}

/// Hides the error panel
#[tauri::command]
fn hide_error_panel(app: AppHandle) -> Result<(), String> {
    panels::hide_error(&app)
}

/// Gets the pending error (Pull Model for HMR resilience)
#[tauri::command]
fn get_pending_error() -> Option<panels::PendingError> {
    panels::get_pending_error()
}

/// Gets the pending control panel (Pull Model for HMR resilience)
#[tauri::command]
fn get_pending_control_panel() -> Option<panels::PendingControlPanel> {
    panels::get_pending_control_panel()
}

/// Checks if any nspanel is currently visible
#[tauri::command]
fn is_any_panel_visible(app: AppHandle) -> bool {
    panels::is_any_panel_visible(&app)
}

/// Closes a standalone control panel window
#[tauri::command]
fn close_control_panel_window(app: AppHandle, instance_id: String) -> Result<(), String> {
    panels::close_control_panel_window(app, instance_id)
}

/// Restarts the application (dev mode only - for manual refresh)
#[tauri::command]
fn restart_app(app: AppHandle) {
    tracing::info!("Restarting application...");
    app.restart();
}

/// Shows the spotlight window/panel
#[tauri::command]
fn show_spotlight(app: AppHandle) -> Result<(), String> {
    panels::show_spotlight(&app)
}

/// Hides the spotlight window/panel
#[tauri::command]
fn hide_spotlight(app: AppHandle) -> Result<(), String> {
    panels::hide_spotlight(&app)
}

/// Resizes the spotlight window based on the number of results and input expansion
#[tauri::command]
fn resize_spotlight(
    app: AppHandle,
    result_count: usize,
    input_expanded: bool,
    compact: bool,
) -> Result<(), String> {
    panels::resize_spotlight(&app, result_count, input_expanded, compact)
}

/// Toggles the spotlight window/panel visibility
fn toggle_spotlight(app: &AppHandle) {
    panels::toggle_spotlight(app);
}

/// Disable the system Spotlight keyboard shortcut
#[cfg(target_os = "macos")]
#[tauri::command]
async fn disable_system_spotlight_shortcut() -> Result<(), String> {
    // Run in blocking task since it does UI automation with sleeps
    tauri::async_runtime::spawn_blocking(|| accessibility::system_spotlight::disable_spotlight_shortcut())
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| e.to_string())
}

/// Check if the system Spotlight shortcut is enabled
#[cfg(target_os = "macos")]
#[tauri::command]
async fn is_system_spotlight_enabled() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| accessibility::system_spotlight::is_spotlight_shortcut_enabled())
        .await
        .map_err(|e| format!("Task join error: {}", e))?
        .map_err(|e| e.to_string())
}

/// Check if the app has accessibility permission
#[cfg(target_os = "macos")]
#[tauri::command]
fn check_accessibility_permission() -> bool {
    let result = crate::accessibility::is_accessibility_trusted();
    tracing::info!(
        has_permission = result,
        exe = ?std::env::current_exe().ok(),
        "Accessibility permission check"
    );
    result
}

/// Open System Settings to the Accessibility pane for granting permission
#[cfg(target_os = "macos")]
#[tauri::command]
fn request_accessibility_permission() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map_err(|e| format!("Failed to open settings: {}", e))?;
    Ok(())
}

/// Check accessibility permission with optional system prompt
#[cfg(target_os = "macos")]
#[tauri::command]
fn check_accessibility_permission_with_prompt(prompt: bool) -> bool {
    crate::accessibility::check_accessibility_with_prompt(prompt)
}

/// Kills the System Settings application
#[cfg(target_os = "macos")]
#[tauri::command]
fn kill_system_settings() -> Result<(), String> {
    std::process::Command::new("pkill")
        .args(["-x", "System Settings"])
        .output()
        .map_err(|e| format!("Failed to kill System Settings: {}", e))?;
    Ok(())
}

/// Initialize shell environment by running login shell.
/// This may trigger macOS Documents permission prompt if shell configs access ~/Documents.
/// Should be called after user explicitly grants Documents permission via the UI.
/// Returns true if a valid PATH was captured from the shell.
#[tauri::command]
fn initialize_shell_environment() -> bool {
    tracing::info!("═══════════════════════════════════════════════════════════════");
    tracing::info!("[tauri-cmd] initialize_shell_environment: called from frontend");
    tracing::info!("═══════════════════════════════════════════════════════════════");

    let start_time = std::time::Instant::now();
    let result = paths::run_login_shell_initialization();
    let elapsed = start_time.elapsed();

    tracing::info!(
        result = result,
        elapsed_ms = elapsed.as_millis(),
        "[tauri-cmd] initialize_shell_environment: completed"
    );
    result
}

/// Check if shell environment has been initialized (login shell has been run).
#[tauri::command]
fn is_shell_initialized() -> bool {
    let result = paths::is_shell_initialized();
    tracing::info!(
        is_initialized = result,
        "[tauri-cmd] is_shell_initialized: returning"
    );
    result
}

/// Check if the app has Documents folder access.
/// This attempts to list ~/Documents to see if we have permission.
/// Note: On first access, this may trigger the macOS permission prompt.
/// Returns true if we can access the folder, false otherwise.
#[tauri::command]
fn check_documents_access() -> bool {
    tracing::info!("[tauri-cmd] check_documents_access: called from frontend");
    let result = paths::check_documents_access();
    tracing::info!(
        has_access = result,
        "[tauri-cmd] check_documents_access: returning"
    );
    result
}

/// Get the captured shell PATH for spawning agent processes.
/// This returns the PATH that was captured from the user's login shell,
/// which includes version manager paths (nvm, fnm, volta, etc.).
#[tauri::command]
fn get_shell_path() -> String {
    let path = paths::shell_path();
    tracing::debug!(
        path_len = path.len(),
        "[tauri-cmd] get_shell_path: returning"
    );
    path
}

/// Get detailed accessibility status for debugging
#[cfg(target_os = "macos")]
#[tauri::command]
fn get_accessibility_status() -> serde_json::Value {
    let has_permission = crate::accessibility::is_accessibility_trusted();
    let exe_path = std::env::current_exe().ok();
    let app_name = exe_path
        .as_ref()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()));

    // Get bundle ID from info dictionary
    let bundle_id = {
        use core_foundation::string::CFString;
        let key = CFString::new("CFBundleIdentifier");
        core_foundation::bundle::CFBundle::main_bundle()
            .info_dictionary()
            .find(&key)
            .and_then(|v| v.downcast::<CFString>())
            .map(|s| s.to_string())
    };

    tracing::info!(
        "Accessibility test: permission={}, app={:?}, bundle={:?}, path={:?}",
        has_permission,
        app_name,
        bundle_id,
        exe_path
    );

    serde_json::json!({
        "has_permission": has_permission,
        "app_name": app_name,
        "exe_path": exe_path.map(|p| p.to_string_lossy().to_string()),
        "bundle_id": bundle_id,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize paths first (required by logging which reads device_id from config)
    paths::initialize();

    // Initialize logging (uses config::get_device_id() for log server)
    logging::initialize();

    // Create AgentHub with socket path in data directory
    let socket_path = paths::data_dir()
        .join("agent-hub.sock")
        .to_string_lossy()
        .to_string();
    let agent_hub = Arc::new(AgentHub::new(socket_path));

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_shell::init())
        .manage(mort_commands::LockManager::new())
        .manage(agent_hub.diagnostic_config())
        .manage(agent_hub.clone())
        .manage(terminal::create_terminal_state())
        .manage(file_watcher::create_file_watcher_state())
        .manage(profiling::ProfilingState(std::sync::Mutex::new(false)));

    builder
        .on_window_event(|window, event| {
            // Log window events with throttling for noisy ones
            match event {
                tauri::WindowEvent::Focused(focused) => {
                    // Log focus changes to diagnose focus theft issues
                    tracing::info!(
                        window = %window.label(),
                        focused = %focused,
                        "[WindowFocus] Window focus changed"
                    );
                }
                tauri::WindowEvent::Resized(size) => {
                    throttle_debug!("window_resized", 500,
                        window = %window.label(),
                        width = %size.width,
                        height = %size.height,
                        "Window resized"
                    );
                }
                tauri::WindowEvent::Moved(_) => {
                    // Intentionally not logging - too noisy
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Intercept close requests for the main window - hide instead of destroy
                    if window.label() == MAIN_WINDOW_LABEL {
                        api.prevent_close();
                        let _ = window.hide();
                        // Revert to Accessory mode when main window is hidden
                        let _ = window
                            .app_handle()
                            .set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                }
                _ => {}
            }
        })
        .on_menu_event(|app, event| {
            let menu_id = event.id().as_ref();

            // Handle navigation menu items
            if let Some(tab) = menu_id.strip_prefix("nav_") {
                // Show main window if hidden
                let _ = show_main_window(app.clone());

                // Emit navigation event to frontend
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.emit("navigate", tab);
                }
            }

            // Handle window menu items
            if menu_id == "close_all_panel_windows" {
                // Close all standalone control panel windows
                let windows = panels::list_control_panel_windows();
                for (instance_id, _) in windows {
                    let _ = panels::close_control_panel_window(app.clone(), instance_id);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            web_log,
            // Logging commands
            logging::get_buffered_logs,
            logging::clear_logs,
            // AgentHub commands
            send_to_agent,
            list_connected_agents,
            get_agent_socket_path,
            agent_hub::update_diagnostic_config,
            register_hotkey,
            save_hotkey,
            get_saved_hotkey,
            save_clipboard_hotkey,
            get_saved_clipboard_hotkey,
            is_onboarded,
            complete_onboarding,
            show_main_window,
            show_main_window_with_view,
            hide_main_window,
            open_control_panel,
            show_control_panel,
            show_control_panel_with_view,
            hide_control_panel,
            focus_control_panel,
            pin_control_panel,
            is_panel_visible,
            show_spotlight,
            hide_spotlight,
            resize_spotlight,
            show_error_panel,
            hide_error_panel,
            get_pending_error,
            get_pending_control_panel,
            is_any_panel_visible,
            close_control_panel_window,
            restart_app,
            app_search::search_applications,
            app_search::open_application,
            app_search::open_directory_in_app,
            clipboard::paste_clipboard_entry,
            clipboard::hide_clipboard_manager,
            clipboard::get_clipboard_history,
            clipboard::get_clipboard_content,
            filesystem::fs_write_file,
            filesystem::fs_read_file,
            filesystem::fs_mkdir,
            filesystem::fs_exists,
            filesystem::fs_remove,
            filesystem::fs_remove_dir_all,
            filesystem::fs_move,
            filesystem::fs_copy_file,
            filesystem::fs_copy_directory,
            filesystem::fs_git_worktree_add,
            filesystem::fs_git_worktree_remove,
            filesystem::fs_list_dir,
            filesystem::fs_is_git_repo,
            // Git commands
            git_commands::git_fetch,
            git_commands::git_get_default_branch,
            git_commands::git_get_branch_commit,
            git_commands::git_create_branch,
            git_commands::git_checkout_branch,
            git_commands::git_checkout_commit,
            git_commands::git_delete_branch,
            git_commands::git_branch_exists,
            git_commands::git_list_mort_branches,
            git_commands::git_create_worktree,
            git_commands::git_remove_worktree,
            git_commands::git_list_worktrees,
            git_commands::git_ls_files,
            git_commands::git_ls_files_untracked,
            git_commands::git_get_head_commit,
            git_commands::git_diff_files,
            // Mort-specific commands
            mort_commands::fs_get_repo_dir,
            mort_commands::fs_get_repo_source_path,
            mort_commands::fs_get_home_dir,
            mort_commands::fs_list_dir_names,
            // Lock commands
            mort_commands::lock_acquire_repo,
            mort_commands::lock_release_repo,
            // Build info commands
            mort_commands::get_paths_info,
            // Agent commands
            mort_commands::get_agent_types,
            // Process commands
            process_commands::kill_process,
            // Shell commands
            shell::run_internal_update,
            // Thread commands
            thread_commands::get_thread_status,
            thread_commands::get_thread,
            // Worktree commands
            worktree_commands::worktree_create,
            worktree_commands::worktree_delete,
            worktree_commands::worktree_rename,
            worktree_commands::worktree_touch,
            worktree_commands::worktree_sync,
            // Spotlight shortcut commands (macOS only)
            #[cfg(target_os = "macos")]
            disable_system_spotlight_shortcut,
            #[cfg(target_os = "macos")]
            is_system_spotlight_enabled,
            #[cfg(target_os = "macos")]
            check_accessibility_permission,
            #[cfg(target_os = "macos")]
            request_accessibility_permission,
            #[cfg(target_os = "macos")]
            check_accessibility_permission_with_prompt,
            #[cfg(target_os = "macos")]
            get_accessibility_status,
            #[cfg(target_os = "macos")]
            kill_system_settings,
            // Shell environment commands
            initialize_shell_environment,
            is_shell_initialized,
            check_documents_access,
            get_shell_path,
            // Repository commands
            repo_commands::validate_repository,
            repo_commands::remove_repository_data,
            // Profiling commands (on-demand, zero overhead at runtime)
            #[cfg(unix)]
            profiling::capture_cpu_profile,
            profiling::start_trace,
            // Terminal commands
            terminal::spawn_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::kill_terminal,
            terminal::list_terminals,
            terminal::kill_terminals_by_cwd,
            // File watcher commands
            file_watcher::start_watch,
            file_watcher::stop_watch,
            file_watcher::list_watches,
            // Identity commands
            identity::get_github_handle,
        ])
        .setup(|app| {
            use tauri::ActivationPolicy;

            // NOTE: paths::initialize() is called in run() before logging::initialize()
            // because logging needs to read device_id from config

            // NOTE: Shell initialization is deferred until first agent spawn via ensureShellInitialized()
            // in the frontend. This avoids triggering the Documents permission prompt before the UI
            // renders, which would bypass the normal permission grant flow.

            // Ensure .mort directories exist (NEW)
            if let Err(e) = ensure_mort_directories() {
                tracing::error!("Failed to ensure .mort directories: {}", e);
            }

            // Start the AgentHub socket server
            let hub: tauri::State<'_, Arc<AgentHub>> = app.state();
            if let Err(e) = hub.start(app.handle().clone()) {
                tracing::error!(error = %e, "Failed to start AgentHub");
            }

            // Set up log buffer to emit events to frontend
            logging::set_app_handle(app.handle().clone());

            // Set activation policy to Accessory for proper panel behavior
            // This removes the app from the Dock (desired for spotlight-style apps)
            let _ = app
                .handle()
                .set_activation_policy(ActivationPolicy::Accessory);

            // Clear any stale repository locks from previous sessions
            mort_commands::clear_all_locks();

            // Initialize config module (uses consolidated .mort/settings/ directory)
            config::initialize();

            // Auto-identify via gh CLI (best-effort, don't block startup)
            std::thread::spawn(|| {
                match identity::identify() {
                    Ok(handle) => tracing::info!(github_handle = %handle, "Auto-identified via gh CLI"),
                    Err(e) => tracing::warn!(error = %e, "Auto-identify failed (gh CLI not available or not authenticated)"),
                }
            });

            // Run TypeScript migrations (spawns Node.js process)
            if let Err(e) = run_ts_migrations(app) {
                // Log error but don't block app startup (graceful degradation)
                tracing::warn!(error = %e, "TypeScript migrations failed (non-fatal)");
            }

            // Initialize panels module with app handle for event callbacks
            panels::initialize(app.handle());

            // Create panels
            if let Err(e) = panels::create_spotlight_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create spotlight panel");
            }
            if let Err(e) = panels::create_clipboard_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create clipboard panel");
            }
            if let Err(e) = panels::create_error_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create error panel");
            }
            if let Err(e) = panels::create_control_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create control panel");
            }
            // Build and set the native macOS menu bar
            #[cfg(target_os = "macos")]
            {
                match menu::build_menu(app.handle()) {
                    Ok(menu) => {
                        if let Err(e) = app.set_menu(menu) {
                            tracing::error!(error = %e, "Failed to set application menu");
                        }
                    }
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to build application menu");
                    }
                }
            }

            // Initialize system tray icon (macOS only)
            #[cfg(target_os = "macos")]
            {
                if let Err(e) = tray::init(app.handle()) {
                    tracing::error!(error = %e, "[Tray] Failed to initialize system tray");
                }
            }

            // Initialize icon cache (extracts icons in background)
            icons::initialize(app.handle());

            // Initialize app index (builds search index in background)
            app_search::initialize();

            // Initialize clipboard monitoring
            clipboard::initialize(app.handle());


            // Handle main window visibility and hotkey registration based on onboarding state
            let onboarded = config::is_onboarded();

            // Check if we should skip showing the main window (useful for dev to prevent focus stealing on rebuild)
            // Skip if MORT_SKIP_MAIN_WINDOW is set to a non-empty value (allows override with MORT_SKIP_MAIN_WINDOW= pnpm dev)
            let skip_main_window = std::env::var("MORT_SKIP_MAIN_WINDOW")
                .map(|v| !v.is_empty())
                .unwrap_or(false);

            // Enable macOS fullscreen button (green traffic light) for the main window
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                enable_fullscreen_button(&window);
            }

            if onboarded {
                // User has onboarded - register saved hotkey (this also registers clipboard hotkey)
                let saved_hotkey = config::get_spotlight_hotkey();
                if let Err(e) = register_hotkey_internal(app.handle(), &saved_hotkey) {
                    tracing::error!(error = %e, "Failed to register saved hotkey");
                }
                // Show main window with the new layout (unless skipped for dev)
                if !skip_main_window {
                    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        let _ = window.show();
                    }
                }
            } else {
                // User hasn't onboarded - show the main window for onboarding (unless skipped for dev)
                if !skip_main_window {
                    // During onboarding, show the dock icon so the app feels like a real app
                    // This helps new users understand they're interacting with a persistent application
                    let _ = app.handle().set_activation_policy(ActivationPolicy::Regular);

                    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        let _ = window.show();
                    }
                }
                // Only register clipboard hotkey (spotlight hotkey will be set during onboarding)
                let clipboard_hotkey = config::get_clipboard_hotkey();
                let clipboard_shortcut: Shortcut = clipboard_hotkey
                    .parse()
                    .expect("Failed to parse clipboard hotkey");
                let app_handle = app.handle().clone();
                app.global_shortcut()
                    .on_shortcut(clipboard_shortcut, move |_app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            clipboard::toggle_clipboard_manager(&app_handle);
                        }
                    })
                    .expect("Failed to register clipboard hotkey");
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::Reopen { .. } => {
                    let _ = show_main_window(app_handle.clone());
                }
                tauri::RunEvent::Exit => {
                    // Clean up AgentHub socket on exit
                    if let Some(hub) = app_handle.try_state::<Arc<AgentHub>>() {
                        tracing::info!("Cleaning up AgentHub on exit");
                        hub.cleanup();
                    }
                    // Kill all terminal PTY processes on exit
                    if let Some(terminal_state) = app_handle.try_state::<TerminalState>() {
                        tracing::info!("Killing all terminals on exit");
                        if let Ok(mut manager) = terminal_state.lock() {
                            manager.kill_all();
                        }
                    }
                    // Stop all file watchers on exit
                    if let Some(watcher_state) = app_handle.try_state::<file_watcher::FileWatcherState>() {
                        tracing::info!("Stopping all file watchers on exit");
                        if let Ok(mut manager) = watcher_state.lock() {
                            manager.cleanup_all();
                        }
                    }
                }
                _ => {}
            }
        });
}
