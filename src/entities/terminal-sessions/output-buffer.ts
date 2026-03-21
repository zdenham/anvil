/**
 * Re-export from the canonical location in the pty module.
 * Kept for backward compatibility with existing imports.
 */
export {
  appendOutput,
  getOutputBuffer,
  clearOutputBuffer,
  destroyOutputBuffer,
  getAllOutputBuffers,
  onOutput,
  decodeOutput,
} from "@/entities/pty/output-buffer";
