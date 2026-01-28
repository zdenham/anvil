import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schemas for Disk Persistence
// Location: ~/.mort/ui/layout.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for layout state.
 * Stores panel widths keyed by persist key.
 */
export const LayoutPersistedStateSchema = z.object({
  panelWidths: z.record(z.string(), z.number()),
});

export type LayoutPersistedState = z.infer<typeof LayoutPersistedStateSchema>;
