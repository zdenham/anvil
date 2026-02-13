//! Icon extraction and caching for macOS applications.
//!
//! This module handles extracting app icons using NSWorkspace and caching them
//! as PNGs for display in the webview. Icons are extracted in the background
//! on startup to ensure zero latency during search.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSBitmapImageRep, NSImage, NSWorkspace};
use objc2_foundation::{NSData, NSDictionary, NSSize, NSString};

/// Global icon cache directory, initialized once on startup
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Icon size for cached PNGs (64x64 for crisp 2x display at 32pt)
const ICON_SIZE: f64 = 64.0;

/// Initializes the icon cache directory and starts background extraction.
/// Should be called once during app setup.
pub fn initialize(app_handle: &tauri::AppHandle) {
    let cache_dir = get_or_create_cache_dir(app_handle);
    let _ = CACHE_DIR.set(cache_dir.clone());

    // Spawn background task to extract all app icons
    std::thread::spawn(move || {
        let _span = tracing::info_span!("icon_extraction").entered();
        extract_all_icons(&cache_dir);
    });
}

/// Returns the cached icon path for an application, or None if not cached.
pub fn get_cached_icon_path(app_path: &str) -> Option<String> {
    let cache_dir = CACHE_DIR.get()?;
    let icon_path = get_icon_cache_path(cache_dir, app_path);

    if icon_path.exists() {
        Some(icon_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Gets or creates the icon cache directory in the app's data folder.
fn get_or_create_cache_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp/mortician"));

    let cache_dir = app_data_dir.join("icon-cache");

    if !cache_dir.exists() {
        let _ = fs::create_dir_all(&cache_dir);
    }

    cache_dir
}

/// Generates a deterministic cache path for an app's icon.
fn get_icon_cache_path(cache_dir: &Path, app_path: &str) -> PathBuf {
    let hash = simple_hash(app_path);
    cache_dir.join(format!("{}.png", hash))
}

/// Simple string hash for generating unique filenames.
fn simple_hash(s: &str) -> u64 {
    let mut hash: u64 = 5381;
    for byte in s.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
    }
    hash
}

/// Extracts icons for all applications in standard locations.
fn extract_all_icons(cache_dir: &Path) {
    let app_dirs = [
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        PathBuf::from("/System/Library/CoreServices"),
        dirs::home_dir()
            .map(|h| h.join("Applications"))
            .unwrap_or_default(),
    ];

    for app_dir in app_dirs {
        if !app_dir.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(&app_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "app") {
                    let app_path = path.to_string_lossy().to_string();
                    extract_icon_if_needed(cache_dir, &app_path);
                }
            }
        }
    }

    tracing::info!("Icon extraction complete");
}

/// Extracts an app's icon using NSWorkspace if not already cached.
fn extract_icon_if_needed(cache_dir: &Path, app_path: &str) {
    let output_path = get_icon_cache_path(cache_dir, app_path);

    // Skip if already cached
    if output_path.exists() {
        return;
    }

    if let Err(e) = extract_icon_via_nsworkspace(app_path, &output_path) {
        tracing::warn!(app_path = %app_path, error = %e, "Failed to extract icon");
    }
}

/// Extracts an app's icon using NSWorkspace and saves it as a PNG.
/// This method works for all app types including those using Asset Catalogs.
fn extract_icon_via_nsworkspace(app_path: &str, output_path: &Path) -> Result<(), String> {
    unsafe {
        // Get the shared workspace
        let workspace = NSWorkspace::sharedWorkspace();

        // Create NSString for the app path
        let path_nsstring = NSString::from_str(app_path);

        // Get the icon for the file
        let icon: Retained<NSImage> = workspace.iconForFile(&path_nsstring);

        // Set the icon size to ensure consistent output
        let size = NSSize::new(ICON_SIZE, ICON_SIZE);
        icon.setSize(size);

        // Convert NSImage to PNG data
        let png_data = nsimage_to_png(&icon)?;

        // Write PNG data to file
        let output_path_str = output_path.to_str().ok_or("Invalid output path")?;
        let output_nsstring = NSString::from_str(output_path_str);
        let success: bool = msg_send![&png_data, writeToFile: &*output_nsstring, atomically: true];

        if success {
            Ok(())
        } else {
            Err("Failed to write PNG file".to_string())
        }
    }
}

/// Converts an NSImage to PNG data.
fn nsimage_to_png(image: &NSImage) -> Result<Retained<NSData>, String> {
    unsafe {
        // Get TIFF representation of the image
        let tiff_data = image
            .TIFFRepresentation()
            .ok_or("Failed to get TIFF representation")?;

        // Create a bitmap image rep from the TIFF data
        let bitmap_rep =
            NSBitmapImageRep::imageRepWithData(&tiff_data).ok_or("Failed to create bitmap rep")?;

        // Convert to PNG (NSBitmapImageFileTypePNG = 4)
        let empty_dict: Retained<NSDictionary<AnyObject, AnyObject>> = NSDictionary::new();
        let png_data: Option<Retained<NSData>> =
            msg_send![&bitmap_rep, representationUsingType: 4u64, properties: &*empty_dict];

        png_data.ok_or("Failed to create PNG representation".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_hash_deterministic() {
        let path = "/Applications/Safari.app";
        assert_eq!(simple_hash(path), simple_hash(path));
    }

    #[test]
    fn test_simple_hash_different_paths() {
        let path1 = "/Applications/Safari.app";
        let path2 = "/Applications/Chrome.app";
        assert_ne!(simple_hash(path1), simple_hash(path2));
    }
}
