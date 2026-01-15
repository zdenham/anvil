# 05 - Tauri Commands (Rust)

**Parallelizable:** Yes (no dependencies)
**Estimated scope:** 2 files modified

## Overview

Add Rust commands for opening and managing simple task windows.

## Tasks

### 1. Add open_simple_task command

**File:** `src-tauri/src/commands/window.rs`

```rust
#[tauri::command]
pub async fn open_simple_task(
    app: AppHandle,
    thread_id: String,
    task_id: String,
    prompt: Option<String>,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    use tauri::WebviewUrl;

    let label = format!("simple-task-{}", thread_id);

    // Build URL with query params
    let mut url = String::from("simple-task.html");
    url.push_str(&format!("?taskId={}&threadId={}", task_id, thread_id));
    if let Some(p) = prompt {
        url.push_str(&format!("&prompt={}", urlencoding::encode(&p)));
    }

    // Check if window already exists
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Create new window
    let window = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(url.into()),
    )
    .title("Simple Task")
    .inner_size(600.0, 500.0)
    .resizable(true)
    .decorations(true)
    .build()
    .map_err(|e| e.to_string())?;

    window.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}
```

### 2. Register the command

**File:** `src-tauri/src/lib.rs`

Add `open_simple_task` to the command registration:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    commands::window::open_simple_task,
])
```

### 3. Add urlencoding dependency (if needed)

**File:** `src-tauri/Cargo.toml`

```toml
[dependencies]
urlencoding = "2.1"
```

## Verification

```bash
cd src-tauri
cargo check
```

Should compile without errors.
