/**
 * Lightweight fetch-based SSE reader for functional tests.
 *
 * Opens a streaming connection, parses SSE frames, and collects events
 * until `maxEvents` is reached or `timeoutMs` elapses. Skips heartbeat
 * comments (lines starting with `:`).
 */

export interface SSETestEvent {
  id: string;
  event: string;
  data: string;
}

interface ReadOptions {
  /** Send Last-Event-ID header for replay */
  lastEventId?: string;
  /** Stop collecting after this many events */
  maxEvents?: number;
  /** Cancel the reader after this many ms (default: 3000) */
  timeoutMs?: number;
}

/**
 * Connect to an SSE endpoint, collect parsed events, and return them.
 *
 * The reader automatically cancels when `maxEvents` events have been
 * collected or when `timeoutMs` elapses, whichever comes first.
 */
export async function readSSEEvents(
  url: string,
  options?: ReadOptions
): Promise<SSETestEvent[]> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (options?.lastEventId) {
    headers["Last-Event-ID"] = options.lastEventId;
  }

  const controller = new AbortController();
  const response = await fetch(url, {
    headers,
    signal: controller.signal,
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: SSETestEvent[] = [];
  const timeoutMs = options?.timeoutMs ?? 3000;

  // Use both reader.cancel() and controller.abort() to reliably stop
  const timeout = setTimeout(() => {
    reader.cancel().catch(() => {});
    controller.abort();
  }, timeoutMs);

  try {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop()!; // keep incomplete frame

      for (const frame of frames) {
        if (frame.startsWith(":")) continue; // heartbeat comment

        const parsed = parseFrame(frame);
        if (parsed) {
          events.push(parsed);
        }

        if (options?.maxEvents && events.length >= options.maxEvents) {
          reader.cancel().catch(() => {});
          controller.abort();
          clearTimeout(timeout);
          return events;
        }
      }
    }
  } catch {
    // AbortError / cancel is expected when timeout or maxEvents triggers
  } finally {
    clearTimeout(timeout);
  }

  return events;
}

function parseFrame(frame: string): SSETestEvent | null {
  const fields: Record<string, string> = {};

  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // inline comment
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 2);

    if (key === "data") {
      // SSE spec: multiple data lines concatenated with newlines
      fields.data = fields.data ? fields.data + "\n" + value : value;
    } else {
      fields[key] = value;
    }
  }

  if (!fields.data || !fields.id || !fields.event) {
    return null;
  }

  return {
    id: fields.id,
    event: fields.event,
    data: fields.data,
  };
}
