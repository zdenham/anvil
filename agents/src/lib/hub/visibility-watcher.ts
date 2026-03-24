import { readFileSync, watch, type FSWatcher } from "fs";
import { join } from "path";
import { getAnvilDir } from "@core/lib/mort-dir.js";
import { PaneLayoutPersistedStateSchema } from "@core/types/pane-layout.js";
import { extractVisibleThreadIds } from "@core/lib/pane-layout.js";
import { LIFECYCLE_EVENTS } from "@core/types/events.js";

const PANE_LAYOUT_PATH = join(getAnvilDir(), "ui", "pane-layout.json");
const RETRY_DELAY_MS = 50;

/**
 * Watches pane-layout.json for changes and maintains a cached set of
 * visible thread IDs. Used by HubClient to gate display events.
 */
export class VisibilityWatcher {
  private visibleThreadIds: Set<string> = new Set();
  private watcher: FSWatcher | null = null;
  private layoutPath: string;

  constructor(layoutPath?: string) {
    this.layoutPath = layoutPath ?? PANE_LAYOUT_PATH;
  }

  /** Read and parse the layout file, updating the visible set. Throws on failure. */
  refresh(): void {
    const raw = readFileSync(this.layoutPath, "utf-8");
    const json = JSON.parse(raw);
    const result = PaneLayoutPersistedStateSchema.safeParse(json);
    if (!result.success) {
      throw new Error(`[visibility-watcher] Invalid pane-layout.json: ${result.error.message}`);
    }
    this.visibleThreadIds = extractVisibleThreadIds(result.data);
  }

  /** Initial read — populate the visible set before any events are sent. */
  start(): void {
    this.refresh();
    this.watcher = watch(this.layoutPath, () => {
      try {
        this.refresh();
      } catch {
        // Partial write — retry once after a short delay
        setTimeout(() => {
          try {
            this.refresh();
          } catch {
            // Keep the watcher alive with the last good cached set.
            // Stale visibility is better than crashing the agent.
          }
        }, RETRY_DELAY_MS);
      }
    });
  }

  /** Check if a given event should be sent based on visibility. */
  shouldSendEvent(eventName: string, threadId: string): boolean {
    if (LIFECYCLE_EVENTS.has(eventName)) return true;
    return this.visibleThreadIds.has(threadId);
  }

  /** Get the current visible thread IDs (for diagnostics). */
  getVisibleThreadIds(): ReadonlySet<string> {
    return this.visibleThreadIds;
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
