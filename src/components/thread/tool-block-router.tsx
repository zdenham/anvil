import { memo } from "react";
import { useThreadContext } from "./thread-context";
import { getSpecializedToolBlock } from "./tool-blocks";
import { ToolUseBlock } from "./tool-use-block";
import { ToolPermissionWrapper } from "./tool-permission-wrapper";
import { LiveAskUserQuestion } from "./live-ask-user-question";

interface ToolBlockRouterProps {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * Routes a tool_use content block to the appropriate rendering component.
 *
 * Props are all stable strings/objects from the content block, making this
 * component safe to memo. Each tool block selects its own state from the
 * store via useToolState — the router only passes stable identifiers.
 */
export const ToolBlockRouter = memo(function ToolBlockRouter({
  toolUseId,
  toolName,
  toolInput,
}: ToolBlockRouterProps) {
  const { threadId } = useThreadContext();

  // AskUserQuestion has its own interactive UI and store integration
  if (toolName === "AskUserQuestion") {
    return (
      <LiveAskUserQuestion
        blockId={toolUseId}
        blockInput={toolInput}
        threadId={threadId}
      />
    );
  }

  const SpecializedBlock = getSpecializedToolBlock(toolName);
  if (SpecializedBlock) {
    return (
      <ToolPermissionWrapper
        toolUseId={toolUseId}
        toolName={toolName}
        toolInput={toolInput}
        threadId={threadId}
      >
        <SpecializedBlock
          id={toolUseId}
          name={toolName}
          input={toolInput}
          threadId={threadId}
        />
      </ToolPermissionWrapper>
    );
  }

  return (
    <ToolUseBlock
      id={toolUseId}
      name={toolName}
      input={toolInput}
      threadId={threadId}
    />
  );
});
