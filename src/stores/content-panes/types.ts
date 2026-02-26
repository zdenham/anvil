import { z } from "zod";
import type { ContentPaneView } from "@/components/content-pane/types";

// ═══════════════════════════════════════════════════════════════════════════
// Zod Schemas for Disk Persistence
// Location: ~/.mort/ui/content-panes.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Schema for ContentPaneView (discriminated union).
 * Validates view types stored on disk.
 */
export const ContentPaneViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("empty") }),
  z.object({ type: z.literal("thread"), threadId: z.string(), autoFocus: z.boolean().optional() }),
  z.object({ type: z.literal("plan"), planId: z.string() }),
  z.object({ type: z.literal("settings") }),
  z.object({ type: z.literal("logs") }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("terminal"), terminalId: z.string() }),
  z.object({ type: z.literal("file"), filePath: z.string(), repoId: z.string().optional(), worktreeId: z.string().optional() }),
  z.object({ type: z.literal("pull-request"), prId: z.string() }),
  z.object({ type: z.literal("changes"), repoId: z.string(), worktreeId: z.string(), uncommittedOnly: z.boolean().optional(), commitHash: z.string().optional() }),
]);

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
