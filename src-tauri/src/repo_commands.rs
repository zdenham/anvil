use std::path::Path;
use serde::Serialize;

#[derive(Serialize)]
pub struct RepoValidation {
    pub exists: bool,
    pub is_git_repo: bool,
    pub error: Option<String>,
}

/// Validate a repository path (standalone, callable from WS server).
pub fn validate_repository_inner(source_path: &str) -> RepoValidation {
    let path = Path::new(source_path);

    if !path.exists() {
        return RepoValidation {
            exists: false,
            is_git_repo: false,
            error: Some("Path does not exist".to_string()),
        };
    }

    let git_path = path.join(".git");
    let is_git = git_path.exists() || path.join("HEAD").exists();

    RepoValidation {
        exists: true,
        is_git_repo: is_git,
        error: if !is_git {
            Some("Not a git repository".to_string())
        } else {
            None
        },
    }
}

#[tauri::command]
pub async fn validate_repository(source_path: String) -> Result<RepoValidation, String> {
    Ok(validate_repository_inner(&source_path))
}

#[tauri::command]
pub async fn remove_repository_data(
    repo_slug: String,
    mort_dir: String,
) -> Result<(), String> {
    // Remove ~/.mort/repositories/{repo_slug} folder
    let repo_settings_path = Path::new(&mort_dir)
        .join("repositories")
        .join(&repo_slug);

    if repo_settings_path.exists() {
        std::fs::remove_dir_all(&repo_settings_path)
            .map_err(|e| format!("Failed to remove repository data: {}", e))?;
    }

    Ok(())
}
