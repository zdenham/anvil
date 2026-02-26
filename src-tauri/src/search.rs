use crate::shell;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadContentMatch {
    pub thread_id: String,
    pub line_content: String,
    pub match_index: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSearchResponse {
    pub matches: Vec<ThreadContentMatch>,
    pub truncated: bool,
}

/// Search thread conversation content by grepping state.json files.
/// Searches `<mort_dir>/threads/` for the query string.
/// Returns matched snippets with thread IDs extracted from directory paths.
#[tauri::command]
pub async fn search_threads(
    mort_dir: String,
    query: String,
    max_results: Option<u32>,
    case_sensitive: Option<bool>,
) -> Result<ThreadSearchResponse, String> {
    let max = max_results.unwrap_or(100) as usize;
    let case_sensitive = case_sensitive.unwrap_or(false);
    let threads_dir = Path::new(&mort_dir).join("threads");

    if !threads_dir.exists() {
        tracing::debug!(path = %threads_dir.display(), "Threads directory does not exist");
        return Ok(ThreadSearchResponse {
            matches: Vec::new(),
            truncated: false,
        });
    }

    // Phase 1: find which state.json files contain the query
    let matching_files = find_matching_files(
        &threads_dir.to_string_lossy(),
        &query,
        case_sensitive,
    )?;

    if matching_files.is_empty() {
        return Ok(ThreadSearchResponse {
            matches: Vec::new(),
            truncated: false,
        });
    }

    tracing::debug!(
        file_count = matching_files.len(),
        "Found matching thread files"
    );

    // Phase 2: get line-level matches from each file
    let mut all_matches = Vec::new();
    let mut truncated = false;

    for file_path in &matching_files {
        if all_matches.len() >= max {
            truncated = true;
            break;
        }

        let thread_id = extract_thread_id(file_path);
        if thread_id.is_none() {
            tracing::warn!(path = %file_path, "Could not extract thread ID from path");
            continue;
        }
        let thread_id = thread_id.unwrap();

        let remaining = max - all_matches.len();
        let file_matches = get_line_matches(
            file_path,
            &query,
            case_sensitive,
            &thread_id,
            remaining,
        )?;

        if all_matches.len() + file_matches.len() > max {
            truncated = true;
            let take = max - all_matches.len();
            all_matches.extend(file_matches.into_iter().take(take));
        } else {
            all_matches.extend(file_matches);
        }
    }

    tracing::debug!(
        match_count = all_matches.len(),
        truncated = truncated,
        "Thread search complete"
    );

    Ok(ThreadSearchResponse {
        matches: all_matches,
        truncated,
    })
}

/// Run `grep -r -F [-i] -l --include="state.json"` to find files containing the query.
fn find_matching_files(
    threads_dir: &str,
    query: &str,
    case_sensitive: bool,
) -> Result<Vec<String>, String> {
    let mut args = vec![
        "-r".to_string(),
        "-F".to_string(),
    ];

    if !case_sensitive {
        args.push("-i".to_string());
    }

    args.push("-l".to_string());
    args.push("--include=state.json".to_string());
    args.push(query.to_string());
    args.push(threads_dir.to_string());

    let output = shell::command("grep")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;

    // Exit code 1 = no matches (not an error)
    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(stderr = %stderr, "grep file search returned error");
        return Err(format!("grep failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: Vec<String> = stdout
        .lines()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    Ok(files)
}

/// Run `grep -F [-i] -n` on a single file to get line-level matches.
/// Returns ThreadContentMatch entries with cleaned-up snippets.
fn get_line_matches(
    file_path: &str,
    query: &str,
    case_sensitive: bool,
    thread_id: &str,
    max: usize,
) -> Result<Vec<ThreadContentMatch>, String> {
    let mut args = vec![
        "-F".to_string(),
        "-n".to_string(),
    ];

    if !case_sensitive {
        args.push("-i".to_string());
    }

    args.push(query.to_string());
    args.push(file_path.to_string());

    let output = shell::command("grep")
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;

    // Exit code 1 = no matches
    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("grep line search failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut matches = Vec::new();
    let mut match_index: u32 = 0;

    for line in stdout.lines() {
        if matches.len() >= max {
            break;
        }

        // Format: line_number:content
        if let Some((_line_num_str, content)) = line.split_once(':') {
            let snippet = clean_json_snippet(content, query);
            if !snippet.is_empty() {
                matches.push(ThreadContentMatch {
                    thread_id: thread_id.to_string(),
                    line_content: snippet,
                    match_index,
                });
                match_index += 1;
            }
        }
    }

    Ok(matches)
}

/// Extract thread ID from a file path like `.../threads/{threadId}/state.json`.
fn extract_thread_id(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);
    // parent of state.json is the thread directory
    let thread_dir = path.parent()?;
    let thread_id = thread_dir.file_name()?.to_str()?;
    Some(thread_id.to_string())
}

/// Strip JSON syntax from a matched line and trim to ~200 chars centered on the match.
fn clean_json_snippet(raw: &str, query: &str) -> String {
    // Strip common JSON syntax: leading whitespace, "key": "...", trailing quotes/commas
    let mut cleaned = raw.trim().to_string();

    // Remove leading "key": " pattern
    if let Some(idx) = cleaned.find("\": \"") {
        // Check if everything before is a quoted key (starts with ")
        let before = cleaned[..idx].trim();
        if before.starts_with('"') {
            cleaned = cleaned[idx + 4..].to_string();
        }
    } else if let Some(idx) = cleaned.find("\": ") {
        let before = cleaned[..idx].trim();
        if before.starts_with('"') {
            cleaned = cleaned[idx + 3..].to_string();
        }
    }

    // Remove trailing quote, comma, bracket combinations
    let trimmed = cleaned.trim_end();
    let trimmed = trimmed.trim_end_matches(',');
    let trimmed = trimmed.trim_end_matches('"');
    let trimmed = trimmed.trim_end_matches(']');
    let trimmed = trimmed.trim_end_matches('}');
    let cleaned = trimmed.trim().to_string();

    if cleaned.is_empty() {
        return String::new();
    }

    // Center ~200 chars around the first occurrence of the query
    let max_snippet_len = 200;
    if cleaned.len() <= max_snippet_len {
        return cleaned;
    }

    // Find query position (case-insensitive)
    let lower_cleaned = cleaned.to_lowercase();
    let lower_query = query.to_lowercase();
    let match_pos = lower_cleaned.find(&lower_query).unwrap_or(0);

    // Center the window around the match
    let half_window = max_snippet_len / 2;
    let start = if match_pos > half_window {
        match_pos - half_window
    } else {
        0
    };
    let end = (start + max_snippet_len).min(cleaned.len());

    let mut snippet = String::new();
    if start > 0 {
        snippet.push_str("...");
    }
    snippet.push_str(&cleaned[start..end]);
    if end < cleaned.len() {
        snippet.push_str("...");
    }

    snippet
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_thread_id() {
        assert_eq!(
            extract_thread_id("/home/user/.mort/threads/abc-123/state.json"),
            Some("abc-123".to_string())
        );
        assert_eq!(
            extract_thread_id("/home/user/.mort/threads/my-thread-id/state.json"),
            Some("my-thread-id".to_string())
        );
        // Root-level file has no parent directory name
        assert_eq!(extract_thread_id("state.json"), None);
    }

    #[test]
    fn test_clean_json_snippet_strips_key_value() {
        let raw = r#"    "content": "Hello world, this is a test","#;
        let result = clean_json_snippet(raw, "Hello");
        assert!(result.contains("Hello world"));
        assert!(!result.starts_with('"'));
    }

    #[test]
    fn test_clean_json_snippet_truncates_long() {
        let long_text = "a".repeat(500);
        let raw = format!(r#"    "text": "{}""#, long_text);
        let result = clean_json_snippet(&raw, "aaa");
        assert!(result.len() <= 210); // 200 + "..." on each side
    }

    #[test]
    fn test_clean_json_snippet_short_passthrough() {
        let raw = r#"some short text"#;
        let result = clean_json_snippet(raw, "short");
        assert_eq!(result, "some short text");
    }
}
