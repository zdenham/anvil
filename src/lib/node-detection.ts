/**
 * Node Detection Utility
 *
 * Checks if Node.js is available in the user's environment.
 * Uses Tauri shell plugin to spawn a node process.
 */

import { Command } from '@tauri-apps/plugin-shell';

export interface NodeAvailability {
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * Check if Node.js is available and get its version.
 *
 * @returns NodeAvailability object indicating if Node.js is available
 */
export async function checkNodeAvailable(): Promise<NodeAvailability> {
  try {
    const command = Command.create('node', ['--version']);
    const output = await command.execute();

    if (output.code === 0) {
      return { available: true, version: output.stdout.trim() };
    }
    return { available: false, error: 'Node.js command failed' };
  } catch {
    return {
      available: false,
      error: 'Node.js not found. Please install Node.js to use quick actions.',
    };
  }
}
