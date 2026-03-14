import { z } from "zod";
import type { ContentPaneView } from "@/components/content-pane/types";
import { ContentPaneViewSchema } from "@core/types/pane-layout.js";

// Re-export for consumers that imported from here
export { ContentPaneViewSchema };

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schemas for Disk Persistence
// Location: ~/.mort/ui/content-panes.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for a single content pane.
 */
export const ContentPaneSchema = z.object({
  id: z.string(),
  view: ContentPaneViewSchema,
});

/**
 * Schema for persisted content panes state.
 */
export const ContentPanesPersistedStateSchema = z.object({
  panes: z.record(z.string(), ContentPaneSchema),
  activePaneId: z.string().nullable(),
});

export type ContentPanesPersistedState = z.infer<typeof ContentPanesPersistedStateSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Content pane with UUID identifier.
 * Re-export the interface for convenience.
 */
export interface ContentPaneData {
  id: string;
  view: ContentPaneView;
}
