/**
 * Stateless, incremental SSE frame parser.
 *
 * Takes a text buffer, extracts complete SSE frames (delimited by double
 * newlines), and returns parsed fields plus the remaining incomplete buffer.
 * Conforms to the SSE spec: multi-line `data:` fields are concatenated
 * with newlines, comment lines (starting with `:`) are silently skipped.
 */

export interface SSEFrame {
  /** The `id:` field — used as Last-Event-ID for reconnect */
  id?: string;
  /** The `event:` field — event type name */
  event?: string;
  /** The `data:` field — concatenated if multi-line */
  data?: string;
}

export interface ParseResult {
  /** Fully parsed SSE frames extracted from the buffer */
  frames: SSEFrame[];
  /** Remaining incomplete text to prepend to the next chunk */
  remainder: string;
}

/**
 * Parse complete SSE frames from a text buffer.
 *
 * SSE frames are delimited by double newlines (`\n\n`). The last segment
 * is always treated as an incomplete frame and returned as `remainder`.
 *
 * @param buffer - Accumulated text from the SSE stream
 * @returns Parsed frames and the leftover incomplete buffer
 */
export function parseSSEFrames(buffer: string): ParseResult {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop()!; // last segment is always incomplete
  const frames: SSEFrame[] = [];

  for (const part of parts) {
    if (part.startsWith(":")) continue; // heartbeat / comment line
    const frame = parseFrameBlock(part);
    if (frame.data) frames.push(frame);
  }

  return { frames, remainder };
}

/**
 * Parse a single SSE frame block (text between double newlines) into
 * its constituent fields.
 */
function parseFrameBlock(block: string): SSEFrame {
  const frame: SSEFrame = {};

  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // inline comment
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 2);

    if (key === "id") {
      frame.id = value;
    } else if (key === "event") {
      frame.event = value;
    } else if (key === "data") {
      // SSE spec: multiple data lines are joined with newlines
      frame.data = frame.data ? frame.data + "\n" + value : value;
    }
  }

  return frame;
}
