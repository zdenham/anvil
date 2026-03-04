//! Command dispatch for the WebSocket server.
//!
//! Routes incoming WS commands to domain-specific dispatch modules.
//! Each domain (fs, git, worktree, misc) lives in its own file to keep
//! dispatch logic under 250 lines per file.

use super::types::WsResponse;
use super::WsState;

/// Dispatch a command by name, deserializing args from JSON.
///
/// Returns a WsResponse with either the result or an error message.
pub async fn dispatch(
    id: u64,
    cmd: &str,
    args: serde_json::Value,
    state: &WsState,
) -> WsResponse {
    match dispatch_inner(cmd, args, state).await {
        Ok(value) => WsResponse::ok(id, value),
        Err(err) => WsResponse::err(id, err),
    }
}

/// Inner dispatch that routes to domain-specific handlers by command prefix.
async fn dispatch_inner(
    cmd: &str,
    args: serde_json::Value,
    state: &WsState,
) -> Result<serde_json::Value, String> {
    // Route by prefix to keep the top-level match small
    if cmd.starts_with("agent_") {
        return super::dispatch_agent::dispatch(cmd, args, state).await;
    }
    if cmd.starts_with("fs_") {
        return super::dispatch_fs::dispatch(cmd, args, state).await;
    }
    if cmd.starts_with("git_") {
        return super::dispatch_git::dispatch(cmd, args).await;
    }
    if cmd.starts_with("worktree_") {
        return super::dispatch_worktree::dispatch(cmd, args).await;
    }

    // Everything else goes through the misc dispatcher
    super::dispatch_misc::dispatch(cmd, args, state).await
}
