//! Miscellaneous command dispatch for the WebSocket server.
//!
//! Handles stateless commands that don't fit neatly into fs/git/worktree domains:
//! paths, threads, repos, search, identity, shell, logging, process, agent types.

use super::dispatch_helpers::{extract_arg, extract_opt_arg};
use super::WsState;

/// Dispatch a miscellaneous command, returning the JSON result.
pub async fn dispatch(
    cmd: &str,
    args: serde_json::Value,
    state: &WsState,
) -> Result<serde_json::Value, String> {
    match cmd {
        // ── Paths / Mort ─────────────────────────────────────────────────
        "get_paths_info" => {
            let result = crate::paths::get_paths_info();
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_agent_types" => {
            let result = crate::mort_commands::get_agent_types();
            Ok(serde_json::to_value(result).unwrap())
        }

        // ── Thread ───────────────────────────────────────────────────────
        "get_thread_status" => {
            let thread_id: String = extract_arg(&args, "threadId")?;
            let result = crate::thread_commands::get_thread_status_inner(&thread_id)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_thread" => {
            let thread_id: String = extract_arg(&args, "threadId")?;
            let result = crate::thread_commands::get_thread_inner(&thread_id)?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ── Repo ─────────────────────────────────────────────────────────
        "validate_repository" => {
            let source_path: String = extract_arg(&args, "sourcePath")?;
            let result = crate::repo_commands::validate_repository_inner(&source_path);
            Ok(serde_json::to_value(result).unwrap())
        }
        "remove_repository_data" => {
            let repo_slug: String = extract_arg(&args, "repoSlug")?;
            let mort_dir: String = extract_arg(&args, "mortDir")?;
            crate::repo_commands::remove_repository_data(repo_slug, mort_dir).await?;
            Ok(serde_json::Value::Null)
        }

        _ => dispatch_part2(cmd, args, state).await,
    }
}

/// Second half of misc dispatch (split to keep functions under 50 lines).
async fn dispatch_part2(
    cmd: &str,
    args: serde_json::Value,
    state: &WsState,
) -> Result<serde_json::Value, String> {
    match cmd {
        // ── Search ───────────────────────────────────────────────────────
        "search_threads" => {
            let mort_dir: String = extract_arg(&args, "mortDir")?;
            let query: String = extract_arg(&args, "query")?;
            let max_results: Option<u32> = extract_opt_arg(&args, "maxResults");
            let case_sensitive: Option<bool> = extract_opt_arg(&args, "caseSensitive");
            let result = crate::search::search_threads_inner(
                &mort_dir,
                &query,
                max_results,
                case_sensitive,
            )
            .await?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ── Identity ─────────────────────────────────────────────────────
        "get_github_handle" => {
            let result = crate::identity::get_github_handle_inner();
            Ok(serde_json::to_value(result).unwrap())
        }

        // ── Lock (stateful — LockManager) ────────────────────────────────
        "lock_acquire_repo" => {
            let repo_name: String = extract_arg(&args, "repoName")?;
            let result = crate::mort_commands::lock_acquire_repo_inner(
                &repo_name,
                &state.lock_manager,
            )
            .await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "lock_release_repo" => {
            let lock_id: String = extract_arg(&args, "lockId")?;
            crate::mort_commands::lock_release_repo_inner(&lock_id, &state.lock_manager)?;
            Ok(serde_json::Value::Null)
        }

        // ── Shell ────────────────────────────────────────────────────────
        "initialize_shell_environment" => {
            let result = crate::paths::run_login_shell_initialization();
            Ok(serde_json::to_value(result).unwrap())
        }
        "is_shell_initialized" => {
            let result = crate::paths::is_shell_initialized();
            Ok(serde_json::to_value(result).unwrap())
        }
        "check_documents_access" => {
            let result = crate::paths::check_documents_access();
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_shell_path" => {
            let result = crate::paths::shell_path();
            Ok(serde_json::to_value(result).unwrap())
        }

        _ => dispatch_part3(cmd, args, state).await,
    }
}

/// Third part of misc dispatch for remaining commands.
async fn dispatch_part3(
    cmd: &str,
    args: serde_json::Value,
    state: &WsState,
) -> Result<serde_json::Value, String> {
    match cmd {
        // ── Logging ──────────────────────────────────────────────────────
        "web_log" => {
            let level: String = extract_arg(&args, "level")?;
            let message: String = extract_arg(&args, "message")?;
            let source: Option<String> = extract_opt_arg(&args, "source");
            crate::logging::log_from_web(
                &level,
                &message,
                source.as_deref().unwrap_or("web"),
            );
            Ok(serde_json::Value::Null)
        }
        "web_log_batch" => {
            let entries: Vec<crate::logging::WebLogEntry> =
                extract_arg(&args, "entries")?;
            crate::logging::log_batch_from_web(entries);
            Ok(serde_json::Value::Null)
        }
        "get_buffered_logs" => {
            let result = crate::logging::get_buffered_logs();
            Ok(serde_json::to_value(result).unwrap())
        }
        "clear_logs" => {
            crate::logging::clear_logs();
            Ok(serde_json::Value::Null)
        }
        "run_internal_update" => {
            crate::shell::run_internal_update()?;
            Ok(serde_json::Value::Null)
        }

        // ── Process ──────────────────────────────────────────────────────
        "kill_process" => {
            let pid: u32 = extract_arg(&args, "pid")?;
            let result = crate::process_commands::kill_process(pid).await?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "get_process_memory" => {
            let result = crate::profiling::get_process_memory()?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "write_memory_snapshot" => {
            let snapshot_json: String = extract_arg(&args, "snapshotJson")?;
            let logs_dir = crate::paths::config_dir().join("logs");
            let result =
                crate::profiling::write_memory_snapshot_inner(snapshot_json, &logs_dir)?;
            Ok(serde_json::to_value(result).unwrap())
        }

        // ── Terminal (stateful — TerminalState) ──────────────────────────
        "list_terminals" => {
            let result = crate::terminal::list_terminals_inner(&state.terminal_state)?;
            Ok(serde_json::to_value(result).unwrap())
        }
        "write_terminal" => {
            let id: u32 = extract_arg(&args, "id")?;
            let data: Vec<u8> = extract_arg(&args, "data")?;
            crate::terminal::write_terminal_inner(&state.terminal_state, id, &data)?;
            Ok(serde_json::Value::Null)
        }
        "resize_terminal" => {
            let id: u32 = extract_arg(&args, "id")?;
            let cols: u16 = extract_arg(&args, "cols")?;
            let rows: u16 = extract_arg(&args, "rows")?;
            crate::terminal::resize_terminal_inner(&state.terminal_state, id, cols, rows)?;
            Ok(serde_json::Value::Null)
        }
        "spawn_terminal" => {
            let cols: u16 = extract_arg(&args, "cols")?;
            let rows: u16 = extract_arg(&args, "rows")?;
            let cwd: String = extract_arg(&args, "cwd")?;
            let broadcaster = state.broadcaster.clone();
            let emit = std::sync::Arc::new(move |event: &str, payload: serde_json::Value| {
                broadcaster.broadcast(event, payload);
            });
            let id = crate::terminal::spawn_terminal_inner(
                &state.terminal_state, cols, rows, cwd, emit,
            )?;
            Ok(serde_json::to_value(id).unwrap())
        }
        "kill_terminal" => {
            let id: u32 = extract_arg(&args, "id")?;
            let broadcaster = state.broadcaster.clone();
            crate::terminal::kill_terminal_inner(&state.terminal_state, id, |event, payload| {
                broadcaster.broadcast(event, payload);
            })?;
            Ok(serde_json::Value::Null)
        }
        "kill_terminals_by_cwd" => {
            let cwd: String = extract_arg(&args, "cwd")?;
            let broadcaster = state.broadcaster.clone();
            let ids = crate::terminal::kill_terminals_by_cwd_inner(
                &state.terminal_state, &cwd, |event, payload| {
                    broadcaster.broadcast(event, payload);
                },
            )?;
            Ok(serde_json::to_value(ids).unwrap())
        }

        // ── File Watcher (stateful — FileWatcherState) ───────────────────
        "start_watch" => {
            let watch_id: String = extract_arg(&args, "watchId")?;
            let path: String = extract_arg(&args, "path")?;
            let recursive: bool = extract_opt_arg(&args, "recursive").unwrap_or(false);
            crate::file_watcher::start_watch_inner(
                &state.file_watcher_state,
                &state.broadcaster,
                watch_id, path, recursive,
            )?;
            Ok(serde_json::Value::Null)
        }
        "stop_watch" => {
            let watch_id: String = extract_arg(&args, "watchId")?;
            crate::file_watcher::stop_watch_inner(&state.file_watcher_state, &watch_id)?;
            Ok(serde_json::Value::Null)
        }
        "list_watches" => {
            let result = crate::file_watcher::list_watches_inner(&state.file_watcher_state);
            Ok(serde_json::to_value(result).unwrap())
        }

        // ── Diagnostics (stateful — DiagnosticConfigState) ───────────────
        "update_diagnostic_config" => {
            let config: crate::agent_hub::DiagnosticLoggingConfig =
                serde_json::from_value(args)
                    .map_err(|e| format!("invalid diagnostic config: {}", e))?;
            crate::agent_hub::update_diagnostic_config_inner(
                config,
                &state.diagnostic_config,
            );
            Ok(serde_json::Value::Null)
        }

        // ── Agent Hub (stateful — AgentHub) ──────────────────────────────
        "list_connected_agents" => {
            let result = state.agent_hub.list_connected_agents();
            Ok(serde_json::to_value(result).unwrap())
        }
        "send_to_agent" => {
            let thread_id: String = extract_arg(&args, "threadId")?;
            let message: String = extract_arg(&args, "message")?;
            state.agent_hub.send_to_agent(&thread_id, &message)?;
            Ok(serde_json::Value::Null)
        }
        "get_agent_socket_path" => {
            let result = state.agent_hub.socket_path().to_string();
            Ok(serde_json::to_value(result).unwrap())
        }

        _ => Err(format!("unknown command: {}", cmd)),
    }
}
