import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schemas for Disk Persistence
// Location: ~/.mort/ui/debug-panel.json
// ═══════════════════════════════════════════════════════════════════════════

export const DebugPanelTabSchema = z.enum(["logs", "diagnostics", "events"]);
export type DebugPanelTab = z.infer<typeof DebugPanelTabSchema>;

export const DebugPanelPersistedStateSchema = z.object({
  activeTab: DebugPanelTabSchema.default("logs"),
  panelHeight: z.number().min(100).max(2000).default(300),
});

export type DebugPanelPersistedState = z.infer<typeof DebugPanelPersistedStateSchema>;
