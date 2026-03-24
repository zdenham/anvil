import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// Pane Layout Zod Schemas (shared between frontend and agents)
// Persistence location: ~/.anvil/ui/pane-layout.json
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
 * Schema for a tab within a pane group.
 */
export const TabItemSchema = z.object({
  id: z.string(),
  view: ContentPaneViewSchema,
  ephemeral: z.boolean().optional(),
});

export type TabItem = z.infer<typeof TabItemSchema>;

/**
 * Schema for a pane group containing ordered tabs.
 */
export const PaneGroupSchema = z.object({
  id: z.string(),
  tabs: z.array(TabItemSchema).max(5),
  activeTabId: z.string(),
});

export type PaneGroup = z.infer<typeof PaneGroupSchema>;

/**
 * Recursive split node schema.
 * A leaf references a group by ID. A split divides space into children.
 */
export const SplitNodeSchema: z.ZodType<SplitNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("leaf"), groupId: z.string() }),
    z.object({
      type: z.literal("split"),
      direction: z.enum(["horizontal", "vertical"]),
      children: z.array(SplitNodeSchema).min(2),
      sizes: z.array(z.number()),
    }),
  ]),
);

export type SplitNode =
  | { type: "leaf"; groupId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: SplitNode[];
      sizes: number[];
    };

/**
 * Schema for the terminal bottom panel state.
 * The terminal panel has its own split tree, mirroring the content zone.
 */
export const TerminalPanelStateSchema = z.object({
  root: SplitNodeSchema,
  height: z.number(),
  isOpen: z.boolean(),
  isMaximized: z.boolean(),
});

export type TerminalPanelState = z.infer<typeof TerminalPanelStateSchema>;

/**
 * Schema for the full persisted pane layout state.
 */
export const PaneLayoutPersistedStateSchema = z.object({
  root: SplitNodeSchema,
  groups: z.record(z.string(), PaneGroupSchema),
  activeGroupId: z.string(),
  terminalPanel: TerminalPanelStateSchema.optional(),
});

export type PaneLayoutPersistedState = z.infer<typeof PaneLayoutPersistedStateSchema>;
