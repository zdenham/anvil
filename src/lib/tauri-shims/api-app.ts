/**
 * Shim: @tauri-apps/api/app
 *
 * Returns stub values for Tauri app metadata APIs.
 */

export async function getVersion(): Promise<string> {
  return "dev";
}

export async function getName(): Promise<string> {
  return "anvil-web";
}

export async function getTauriVersion(): Promise<string> {
  return "0.0.0";
}
