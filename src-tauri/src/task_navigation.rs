use tauri::AppHandle;
use crate::panels;

/// Toggle the task panel open/closed - simple version without navigation complexity
pub fn toggle_task_panel(app: &AppHandle) {
    tracing::info!("toggle_task_panel - Toggling task panel visibility");

    if panels::is_panel_visible(app, panels::TASKS_LIST_LABEL) {
        tracing::info!("toggle_task_panel - Panel is visible, hiding it");
        let _ = panels::hide_tasks_list(app);
    } else {
        tracing::info!("toggle_task_panel - Panel is hidden, showing it");
        let _ = panels::show_tasks_list(app);
    }
}