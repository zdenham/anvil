#[cfg(target_os = "macos")]
pub mod accessibility;

#[cfg(target_os = "macos")]
mod cgevent_test;

#[cfg(target_os = "macos")]
mod navigation_mode;

// Make public for mort-test CLI access
#[cfg(target_os = "macos")]
pub use accessibility::{is_accessibility_trusted, check_accessibility_with_prompt};
#[cfg(target_os = "macos")]
pub use accessibility::{disable_spotlight_shortcut, is_spotlight_shortcut_enabled};
#[cfg(target_os = "macos")]
pub use accessibility::SystemSettingsNavigator;
#[path = "app-search.rs"]
mod app_search;
mod build_info;
mod clipboard;
mod clipboard_db;
mod config;
mod filesystem;
mod git_commands;
mod icons;
mod logging;
mod mort_commands;
mod panels;
mod paths;
mod process_commands;
mod shell;
mod thread_commands;
mod worktree_commands;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

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

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

    // Register task navigation mode hotkeys - macOS only
    #[cfg(target_os = "macos")]
    {
        let task_nav_down_hotkey = config::get_task_navigation_down_hotkey();
        tracing::info!(
            hotkey = %task_nav_down_hotkey,
            hotkey_len = task_nav_down_hotkey.len(),
            hotkey_bytes = ?task_nav_down_hotkey.as_bytes(),
            "Attempting to register task navigation down hotkey"
        );

        let task_nav_down_shortcut: Shortcut = task_nav_down_hotkey
            .parse()
            .map_err(|e| {
                tracing::error!(
                    hotkey = %task_nav_down_hotkey,
                    error = ?e,
                    "Failed to parse task navigation down hotkey"
                );
                format!("Failed to parse task navigation down hotkey '{}': {:?}", task_nav_down_hotkey, e)
            })?;

        tracing::debug!(
            shortcut = ?task_nav_down_shortcut,
            "Parsed task navigation down shortcut successfully"
        );

        let task_nav_down_hotkey_clone = task_nav_down_hotkey.clone();
        app.global_shortcut()
            .on_shortcut(task_nav_down_shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    navigation_mode::get_navigation_mode()
                        .on_hotkey_pressed(navigation_mode::NavigationDirection::Down, &task_nav_down_hotkey_clone);
                }
            })
            .map_err(|e| {
                tracing::error!(
                    hotkey = %task_nav_down_hotkey,
                    error = ?e,
                    "Failed to register task navigation down hotkey with global_shortcut"
                );
                format!("Failed to register task navigation down hotkey: {:?}", e)
            })?;

        let task_nav_up_hotkey = config::get_task_navigation_up_hotkey();
        tracing::info!(
            hotkey = %task_nav_up_hotkey,
            hotkey_len = task_nav_up_hotkey.len(),
            hotkey_bytes = ?task_nav_up_hotkey.as_bytes(),
            "Attempting to register task navigation up hotkey"
        );

        let task_nav_up_shortcut: Shortcut = task_nav_up_hotkey
            .parse()
            .map_err(|e| {
                tracing::error!(
                    hotkey = %task_nav_up_hotkey,
                    error = ?e,
                    "Failed to parse task navigation up hotkey"
                );
                format!("Failed to parse task navigation up hotkey '{}': {:?}", task_nav_up_hotkey, e)
            })?;

        tracing::debug!(
            shortcut = ?task_nav_up_shortcut,
            "Parsed task navigation up shortcut successfully"
        );

        let task_nav_up_hotkey_clone = task_nav_up_hotkey.clone();
        app.global_shortcut()
            .on_shortcut(task_nav_up_shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    navigation_mode::get_navigation_mode()
                        .on_hotkey_pressed(navigation_mode::NavigationDirection::Up, &task_nav_up_hotkey_clone);
                }
            })
            .map_err(|e| {
                tracing::error!(
                    hotkey = %task_nav_up_hotkey,
                    error = ?e,
                    "Failed to register task navigation up hotkey with global_shortcut"
                );
                format!("Failed to register task navigation up hotkey: {:?}", e)
            })?;

        tracing::info!(down = %task_nav_down_hotkey, up = %task_nav_up_hotkey, "Registered task navigation mode hotkeys successfully");
    }

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

/// Saves the task navigation down hotkey to config and re-registers hotkeys
#[tauri::command]
fn save_task_navigation_down_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    config::set_task_navigation_down_hotkey(&hotkey)?;
    let spotlight_hotkey = config::get_spotlight_hotkey();
    register_hotkey_internal(&app, &spotlight_hotkey)
}

/// Gets the saved task navigation down hotkey from config
#[tauri::command]
fn get_saved_task_navigation_down_hotkey() -> String {
    config::get_task_navigation_down_hotkey()
}

/// Saves the task navigation up hotkey to config and re-registers hotkeys
#[tauri::command]
fn save_task_navigation_up_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    config::set_task_navigation_up_hotkey(&hotkey)?;
    let spotlight_hotkey = config::get_spotlight_hotkey();
    register_hotkey_internal(&app, &spotlight_hotkey)
}

/// Gets the saved task navigation up hotkey from config
#[tauri::command]
fn get_saved_task_navigation_up_hotkey() -> String {
    config::get_task_navigation_up_hotkey()
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
        let window = tauri::WebviewWindowBuilder::new(
            &app,
            MAIN_WINDOW_LABEL,
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("Mort")
        .inner_size(600.0, 500.0)
        .resizable(true)
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

/// Opens the task panel and displays a specific task
/// If prompt is provided, shows optimistic UI with the prompt text before task loads
/// task_id is required - all threads must be associated with a task
#[tauri::command]
fn open_task(
    app: AppHandle,
    thread_id: String,
    task_id: String,
    prompt: Option<String>,
    repo_name: Option<String>,
) -> Result<(), String> {
    panels::show_task(
        &app,
        &thread_id,
        &task_id,
        prompt.as_deref(),
        repo_name.as_deref(),
    )
}

/// Opens a simple task panel for a specific thread
/// If prompt is provided, shows optimistic UI with the prompt text before task loads
/// NOTE: This must be synchronous (not async) because NSPanel operations require main thread
#[tauri::command]
fn open_simple_task(
    app: AppHandle,
    thread_id: String,
    task_id: String,
    prompt: Option<String>,
) -> Result<(), String> {
    panels::show_simple_task(&app, &thread_id, &task_id, prompt.as_deref())
}

/// Hides the task panel
#[tauri::command]
fn hide_task(app: AppHandle) -> Result<(), String> {
    panels::hide_task(&app)
}

/// Hides the simple task panel
#[tauri::command]
fn hide_simple_task(app: AppHandle) -> Result<(), String> {
    panels::hide_simple_task(&app)
}

/// Forces focus on the simple task panel if it's visible
#[tauri::command]
fn focus_simple_task_panel(app: AppHandle) -> Result<(), String> {
    panels::focus_simple_task_panel(&app)
}

/// Pins the simple task panel (prevents hide on blur during drag/resize)
#[tauri::command]
fn pin_simple_task_panel() {
    panels::pin_simple_task_panel()
}

/// Unpins the simple task panel (allows hide on blur)
#[tauri::command]
fn unpin_simple_task_panel() {
    panels::unpin_simple_task_panel()
}

/// Checks if a specific panel is visible
#[tauri::command]
fn is_panel_visible(app: AppHandle, panel_label: String) -> bool {
    panels::is_panel_visible(&app, &panel_label)
}

/// Gets the pending task (Pull Model for HMR resilience)
#[tauri::command]
fn get_pending_task() -> Option<panels::PendingTask> {
    panels::get_pending_task()
}

/// Clears the pending task (called when panel is hidden)
#[tauri::command]
fn clear_pending_task() {
    panels::clear_pending_task()
}

/// Peeks at the pending task without clearing it
#[tauri::command]
fn peek_pending_task() -> Option<panels::PendingTask> {
    panels::peek_pending_task()
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

/// Gets the pending simple task (Pull Model for HMR resilience)
#[tauri::command]
fn get_pending_simple_task() -> Option<panels::PendingSimpleTask> {
    panels::get_pending_simple_task()
}

/// Shows the tasks list panel
#[tauri::command]
fn show_tasks_panel(app: AppHandle) -> Result<(), String> {
    panels::show_tasks_list(&app)
}

/// Hides the tasks list panel
#[tauri::command]
fn hide_tasks_panel(app: AppHandle) -> Result<(), String> {
    panels::hide_tasks_list(&app)
}

/// Checks if any nspanel is currently visible
#[tauri::command]
fn is_any_panel_visible(app: AppHandle) -> bool {
    panels::is_any_panel_visible(&app)
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
) -> Result<(), String> {
    panels::resize_spotlight(&app, result_count, input_expanded)
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
    paths::run_login_shell_initialization()
}

/// Check if shell environment has been initialized (login shell has been run).
#[tauri::command]
fn is_shell_initialized() -> bool {
    paths::is_shell_initialized()
}

/// Check if the app has Documents folder access.
/// This attempts to list ~/Documents to see if we have permission.
/// Note: On first access, this may trigger the macOS permission prompt.
/// Returns true if we can access the folder, false otherwise.
#[tauri::command]
fn check_documents_access() -> bool {
    paths::check_documents_access()
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
    // Initialize logging first
    logging::initialize();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_shell::init())
        .manage(process_commands::ProcessManager::new())
        .manage(mort_commands::LockManager::new());

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
                tauri::WindowEvent::Moved(pos) => {
                    throttle_debug!("window_moved", 500,
                        window = %window.label(),
                        x = %pos.x,
                        y = %pos.y,
                        "Window moved"
                    );
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
        .invoke_handler(tauri::generate_handler![
            web_log,
            greet,
            register_hotkey,
            save_hotkey,
            get_saved_hotkey,
            save_clipboard_hotkey,
            get_saved_clipboard_hotkey,
            save_task_navigation_down_hotkey,
            get_saved_task_navigation_down_hotkey,
            save_task_navigation_up_hotkey,
            get_saved_task_navigation_up_hotkey,
            is_onboarded,
            complete_onboarding,
            show_main_window,
            hide_main_window,
            open_task,
            open_simple_task,
            hide_task,
            hide_simple_task,
            focus_simple_task_panel,
            pin_simple_task_panel,
            unpin_simple_task_panel,
            is_panel_visible,
            get_pending_task,
            clear_pending_task,
            peek_pending_task,
            show_spotlight,
            hide_spotlight,
            resize_spotlight,
            show_error_panel,
            hide_error_panel,
            get_pending_error,
            get_pending_simple_task,
            show_tasks_panel,
            hide_tasks_panel,
            is_any_panel_visible,
            restart_app,
            app_search::search_applications,
            app_search::open_application,
            app_search::open_directory_in_app,
            clipboard::get_clipboard_history,
            clipboard::get_clipboard_content,
            clipboard::paste_clipboard_entry,
            clipboard::delete_clipboard_entry,
            clipboard::clear_clipboard_history,
            clipboard::show_clipboard_manager,
            clipboard::hide_clipboard_manager,
            filesystem::fs_write_file,
            filesystem::fs_read_file,
            filesystem::fs_mkdir,
            filesystem::fs_exists,
            filesystem::fs_remove,
            filesystem::fs_remove_dir_all,
            filesystem::fs_list_dir,
            filesystem::fs_move,
            filesystem::fs_copy_file,
            filesystem::fs_copy_directory,
            filesystem::fs_is_git_repo,
            filesystem::fs_git_worktree_add,
            filesystem::fs_git_worktree_remove,
            filesystem::list_repositories,
            filesystem::delete_git_branch,
            filesystem::list_mort_branches,
            // Git commands
            git_commands::git_get_default_branch,
            git_commands::git_get_branch_commit,
            git_commands::git_get_branch_commits,
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
            // Thread status
            mort_commands::thread_get_status,
            // Task commands (agent updates)
            mort_commands::update_task,
            // Build info commands
            mort_commands::get_paths_info,
            mort_commands::get_default_hotkeys,
            // Agent commands
            mort_commands::get_agent_types,
            // Process commands
            process_commands::get_runner_path,
            process_commands::spawn_agent_process,
            process_commands::terminate_agent_process,
            process_commands::is_process_running,
            process_commands::submit_tool_result,
            process_commands::kill_process,
            // Shell commands
            shell::get_shell_path,
            shell::which_binary,
            shell::run_internal_update,
            // Thread commands
            thread_commands::get_thread_status,
            thread_commands::get_thread,
            // Worktree commands
            worktree_commands::worktree_list,
            worktree_commands::worktree_create,
            worktree_commands::worktree_delete,
            worktree_commands::worktree_rename,
            worktree_commands::worktree_touch,
            worktree_commands::worktree_sync,
            // Logging commands
            logging::get_buffered_logs,
            logging::clear_logs,
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
            // CGEvent tap test commands (macOS only)
            #[cfg(target_os = "macos")]
            cgevent_test::start_cgevent_test,
            #[cfg(target_os = "macos")]
            cgevent_test::stop_cgevent_test,
            #[cfg(target_os = "macos")]
            cgevent_test::is_cgevent_test_running,
            // Shell environment commands
            initialize_shell_environment,
            is_shell_initialized,
            check_documents_access,
            // Navigation mode commands (macOS only)
            #[cfg(target_os = "macos")]
            navigation_mode::navigation_hotkey_down,
            #[cfg(target_os = "macos")]
            navigation_mode::navigation_hotkey_up,
            #[cfg(target_os = "macos")]
            navigation_mode::navigation_panel_blur,
            #[cfg(target_os = "macos")]
            navigation_mode::is_navigation_mode_active,
            #[cfg(target_os = "macos")]
            navigation_mode::get_navigation_state,
        ])
        .setup(|app| {
            use tauri::ActivationPolicy;

            // Initialize paths first (before anything that might use them)
            paths::initialize();

            // Ensure .mort directories exist (NEW)
            if let Err(e) = ensure_mort_directories() {
                tracing::error!("Failed to ensure .mort directories: {}", e);
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

            // Initialize panels module with app handle for event callbacks
            panels::initialize(app.handle());

            // Initialize navigation mode (macOS only)
            #[cfg(target_os = "macos")]
            navigation_mode::initialize(app.handle());

            // Create panels
            if let Err(e) = panels::create_spotlight_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create spotlight panel");
            }
            if let Err(e) = panels::create_clipboard_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create clipboard panel");
            }
            if let Err(e) = panels::create_task_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create task panel");
            }
            if let Err(e) = panels::create_error_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create error panel");
            }
            if let Err(e) = panels::create_simple_task_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create simple task panel");
            }
            if let Err(e) = panels::create_tasks_list_panel(app.handle()) {
                tracing::error!(error = %e, "Failed to create tasks list panel");
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
            let skip_main_window = std::env::var("MORT_SKIP_MAIN_WINDOW").is_ok();

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
            if let tauri::RunEvent::Reopen { .. } = event {
                let _ = show_main_window(app_handle.clone());
            }
        });
}
