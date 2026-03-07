/**
 * Terminal output buffer manager.
 * Stores output outside of Zustand for zero-overhead writes on the hot path.
 *
 * No React re-renders, no shallow copies, no subscriber notifications —
 * just a Map<string, string> and a newline counter for O(n)-of-new-data trimming.
 */
import { OUTPUT_BUFFER_MAX_LINES } from "./types";

/** Stored buffers keyed by terminal ID */
const buffers = new Map<string, string>();

/** Running newline counts per buffer (avoids re-scanning the whole string) */
const newlineCounts = new Map<string, number>();

/** Subscribers for live decoded output (terminal-content subscribes here) */
type OutputCallback = (text: string) => void;
const outputListeners = new Map<string, Set<OutputCallback>>();

/** Per-terminal TextDecoder instances with stream mode enabled.
 * Each terminal gets its own decoder so interleaved chunks don't corrupt
 * each other's buffered partial UTF-8 sequences. */
const decoders = new Map<string, TextDecoder>();

function getDecoder(id: string): TextDecoder {
  let dec = decoders.get(id);
  if (!dec) {
    dec = new TextDecoder("utf-8");
    decoders.set(id, dec);
  }
  return dec;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countNewlines(s: string): number {
  let count = 0;
  let idx = -1;
  while ((idx = s.indexOf("\n", idx + 1)) !== -1) {
    count++;
  }
  return count;
}

/** Return the index immediately *after* the Nth newline. */
function indexAfterNthNewline(s: string, n: number): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") {
      count++;
      if (count === n) return i + 1;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode raw PTY bytes into a string.
 * Uses a per-terminal TextDecoder with `stream: true` so multi-byte UTF-8
 * characters split across chunks are buffered and decoded correctly.
 */
export function decodeOutput(id: string, data: number[]): string {
  return getDecoder(id).decode(new Uint8Array(data), { stream: true });
}

/**
 * Append already-decoded text to a terminal's output buffer.
 * Trims to OUTPUT_BUFFER_MAX_LINES using newline-index scanning —
 * no split()/join() overhead.
 */
export function appendOutput(id: string, text: string): void {
  const existing = buffers.get(id) || "";
  let buffer = existing + text;
  let nlCount = (newlineCounts.get(id) || 0) + countNewlines(text);

  // Original logic: split("\n").length > MAX  ⇒  nlCount + 1 > MAX
  if (nlCount + 1 > OUTPUT_BUFFER_MAX_LINES) {
    const excess = nlCount + 1 - OUTPUT_BUFFER_MAX_LINES;
    const trimIdx = indexAfterNthNewline(buffer, excess);
    if (trimIdx > 0) {
      buffer = buffer.slice(trimIdx);
      nlCount = OUTPUT_BUFFER_MAX_LINES - 1;
    }
  }

  buffers.set(id, buffer);
  newlineCounts.set(id, nlCount);

  // Notify live subscribers (e.g. terminal-content writing to xterm.js)
  const cbs = outputListeners.get(id);
  if (cbs) {
    for (const cb of cbs) {
      cb(text);
    }
  }
}

/** Get the stored output buffer for a terminal. */
export function getOutputBuffer(id: string): string {
  return buffers.get(id) || "";
}

/** Delete a terminal's output buffer and decoder. */
export function clearOutputBuffer(id: string): void {
  buffers.delete(id);
  newlineCounts.delete(id);
  outputListeners.delete(id);
  decoders.delete(id);
}

/** Read-only access to all buffers (for memory diagnostics). */
export function getAllOutputBuffers(): ReadonlyMap<string, string> {
  return buffers;
}

/**
 * Subscribe to live decoded output for a terminal.
 * Returns an unsubscribe function.
 */
export function onOutput(id: string, callback: OutputCallback): () => void {
  let cbs = outputListeners.get(id);
  if (!cbs) {
    cbs = new Set();
    outputListeners.set(id, cbs);
  }
  cbs.add(callback);

  return () => {
    cbs!.delete(callback);
    if (cbs!.size === 0) {
      outputListeners.delete(id);
    }
  };
}
