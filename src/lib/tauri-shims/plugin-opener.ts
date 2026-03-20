/**
 * Shim: @tauri-apps/plugin-opener
 *
 * Opens URLs using the browser's native window.open().
 */

export async function openUrl(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openPath(_path: string): Promise<void> {
  // Cannot open filesystem paths from browser
}

export async function revealItemInDir(_path: string): Promise<void> {
  // Cannot reveal files in browser
}
