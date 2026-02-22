use crate::config;
use crate::paths;
use tracing::{info, warn};

const IDENTITY_SERVER_URL: &str = "https://mort-server.fly.dev/identity";

/// Detect the GitHub handle via `gh` CLI and persist it.
/// Returns the handle on success, or an error if `gh` is not authenticated.
pub fn identify() -> Result<String, String> {
    let output = std::process::Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .env("PATH", paths::shell_path())
        .output()
        .map_err(|e| format!("Failed to run `gh`: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`gh api user` failed: {}", stderr.trim()));
    }

    let handle = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if handle.is_empty() {
        return Err("`gh api user` returned empty login".to_string());
    }

    // Persist in app config
    config::set_github_handle(&handle)?;
    let device_id = config::get_device_id();
    info!(device_id = %device_id, github_handle = %handle, "Identity detected via gh CLI");

    // Register with server (best-effort, background)
    let did = device_id.clone();
    let gh = handle.clone();
    std::thread::spawn(move || {
        if let Err(e) = register_with_server(&did, &gh) {
            warn!(error = %e, "Failed to register identity with server");
        }
    });

    Ok(handle)
}

fn register_with_server(device_id: &str, github_handle: &str) -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var("IDENTITY_SERVER_URL")
        .unwrap_or_else(|_| IDENTITY_SERVER_URL.to_string());

    #[derive(serde::Serialize)]
    struct Payload<'a> {
        device_id: &'a str,
        github_handle: &'a str,
    }

    ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(&Payload { device_id, github_handle })?;

    info!(device_id = %device_id, "Identity registered with server");
    Ok(())
}

/// Tauri command: get the current GitHub handle, if identified.
#[tauri::command]
pub fn get_github_handle() -> Option<String> {
    config::get_github_handle()
}
