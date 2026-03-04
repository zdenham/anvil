//! HTTP file serving handler for the WS server.
//!
//! Serves local files at `GET /files?path=/absolute/path` with correct MIME types.
//! Replaces Tauri's `convertFileSrc()` for browser-based development.

use axum::extract::Query;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
pub struct FileQuery {
    path: Option<String>,
}

/// Serve a file from the local filesystem.
///
/// Returns the file bytes with the correct Content-Type header based on extension.
/// Returns 400 for missing `path` param, 404 for missing files.
pub async fn serve_file(Query(query): Query<FileQuery>) -> impl IntoResponse {
    let path = match query.path {
        Some(p) if !p.is_empty() => p,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                "Missing required query parameter: path",
            )
                .into_response();
        }
    };

    let file_path = Path::new(&path);
    if !file_path.is_absolute() {
        return (StatusCode::BAD_REQUEST, "Path must be absolute").into_response();
    }

    if !file_path.exists() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    if file_path.is_dir() {
        return (StatusCode::BAD_REQUEST, "Path is a directory, not a file").into_response();
    }

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(path = %path, error = %e, "Failed to read file for serving");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read file: {}", e),
            )
                .into_response();
        }
    };

    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, mime)],
        bytes,
    )
        .into_response()
}
