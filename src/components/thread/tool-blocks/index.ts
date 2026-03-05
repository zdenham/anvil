/**
 * Tool block registry.
 * Maps tool names to specialized rendering components.
 */
import type { ComponentType } from "react";
import { BashToolBlock } from "./bash-tool-block";
import { EditToolBlock } from "./edit-tool-block";
import { EnterPlanModeToolBlock } from "./enterplanmode-tool-block";
import { ExitPlanModeToolBlock } from "./exitplanmode-tool-block";
import { GlobToolBlock } from "./glob-tool-block";
import { GrepToolBlock } from "./grep-tool-block";
import { KillShellToolBlock } from "./killshell-tool-block";
import { LSPToolBlock } from "./lsp-tool-block";
import { NotebookEditToolBlock } from "./notebook-edit-tool-block";
import { ReadToolBlock } from "./read-tool-block";
import { SkillToolBlock } from "./skill-tool-block";
import { TaskOutputToolBlock } from "./taskoutput-tool-block";
import { TaskStopToolBlock } from "./taskstop-tool-block";
import { TaskToolBlock } from "./task-tool-block";
import { TodoWriteToolBlock } from "./todowrite-tool-block";
import { WebFetchToolBlock } from "./web-fetch-tool-block";
import { WebSearchToolBlock } from "./web-search-tool-block";
import { WriteToolBlock } from "./write-tool-block";

export interface ToolBlockProps {
  /** Unique tool use ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Thread ID for store selectors and expand state */
  threadId: string;
}

type ToolBlockComponent = ComponentType<ToolBlockProps>;

/**
 * Registry mapping tool names (lowercase) to specialized components.
 * Tools not in this registry will use the generic ToolUseBlock.
 */
const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  edit: EditToolBlock,
  enterplanmode: EnterPlanModeToolBlock,
  exitplanmode: ExitPlanModeToolBlock,
  glob: GlobToolBlock,
  grep: GrepToolBlock,
  killshell: KillShellToolBlock,
  lsp: LSPToolBlock,
  notebookedit: NotebookEditToolBlock,
  read: ReadToolBlock,
  skill: SkillToolBlock,
  task: TaskToolBlock,
  agent: TaskToolBlock, // SDK ≥0.2.64 renamed Task → Agent
  taskoutput: TaskOutputToolBlock,
  taskstop: TaskStopToolBlock,
  todowrite: TodoWriteToolBlock,
  webfetch: WebFetchToolBlock,
  websearch: WebSearchToolBlock, // Client tool name (WebSearch -> websearch)
  web_search: WebSearchToolBlock, // Server-side tool name (server_tool_use)
  write: WriteToolBlock,
};

/**
 * Get the appropriate component for rendering a tool block.
 * Returns the specialized component if one exists, otherwise null.
 */
export function getSpecializedToolBlock(
  toolName: string
): ToolBlockComponent | null {
  const normalized = toolName.toLowerCase();
  return TOOL_BLOCK_REGISTRY[normalized] ?? null;
}

export {
  BashToolBlock,
  EditToolBlock,
  EnterPlanModeToolBlock,
  ExitPlanModeToolBlock,
  GlobToolBlock,
  GrepToolBlock,
  KillShellToolBlock,
  LSPToolBlock,
  NotebookEditToolBlock,
  ReadToolBlock,
  SkillToolBlock,
  TaskOutputToolBlock,
  TaskStopToolBlock,
  TaskToolBlock,
  TodoWriteToolBlock,
  WebFetchToolBlock,
  WebSearchToolBlock,
  WriteToolBlock,
};
