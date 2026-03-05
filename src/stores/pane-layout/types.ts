import { z } from "zod";
import { ContentPaneViewSchema } from "@/stores/content-panes/types";

// Persistence location: ~/.mort/ui/pane-layout.json

/**
 * Schema for a tab within a pane group.
 */
export const TabItemSchema = z.object({
  id: z.string(),
  view: ContentPaneViewSchema,
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
 * Schema for the full persisted pane layout state.
 */
export const PaneLayoutPersistedStateSchema = z.object({
  root: SplitNodeSchema,
  groups: z.record(z.string(), PaneGroupSchema),
  activeGroupId: z.string(),
});

export type PaneLayoutPersistedState = z.infer<typeof PaneLayoutPersistedStateSchema>;
