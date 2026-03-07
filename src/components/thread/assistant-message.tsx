import { memo } from "react";
import type {
  ContentBlock,
  ServerToolUseBlock,
  WebSearchToolResultBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { RenderContentBlock } from "@core/types/events.js";
import { useThreadContext } from "./thread-context";
import { useMessageContent } from "@/hooks/use-thread-selectors";
import { TextBlock } from "./text-block";
import { ThinkingBlock } from "./thinking-block";
import { TrickleBlock } from "./trickle-block";
import { ToolBlockRouter } from "./tool-block-router";
import { ToolUseBlock } from "./tool-use-block";
import { WebSearchToolBlock } from "./tool-blocks/web-search-tool-block";
import { WorkspaceRootProvider } from "@/hooks/use-workspace-root";

interface AssistantMessageProps {
  /** Stable ID of this assistant message */
  messageId: string;
}

/**
 * Container for a single assistant turn.
 * Renders committed content (text, thinking, tool use) and streaming content
 * (isStreaming blocks) inline via TrickleBlock.
 */
export const AssistantMessage = memo(function AssistantMessage({
  messageId,
}: AssistantMessageProps) {
  const { threadId, workingDirectory } = useThreadContext();
  const content = useMessageContent(threadId, messageId) as (ContentBlock | RenderContentBlock)[];

  // Find the last streaming block index for cursor placement
  const lastStreamingIndex = content.reduce(
    (acc, block, i) => ((block as RenderContentBlock).isStreaming ? i : acc),
    -1,
  );

  return (
    <WorkspaceRootProvider value={workingDirectory}>
      <article role="article" aria-label="Assistant response" className="group">
        <div className="flex gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            {content.map((block, index) => {
              const renderBlock = block as RenderContentBlock;

              // Streaming text/thinking — render with TrickleBlock
              if (renderBlock.isStreaming) {
                const blockContent =
                  (renderBlock.type === "text" ? renderBlock.text : renderBlock.thinking) ?? "";
                const isLast = index === lastStreamingIndex;

                return (
                  <div key={renderBlock.id ?? `streaming-${renderBlock.type}-${index}`} className="relative">
                    <TrickleBlock
                      block={{ type: renderBlock.type as "text" | "thinking", content: blockContent }}
                      isLast={isLast}
                      workingDirectory={workingDirectory}
                    />
                  </div>
                );
              }

              // Committed content
              switch (block.type) {
                case "text":
                  return (
                    <TextBlock
                      key={renderBlock.id ?? `text-${index}`}
                      content={(block as ContentBlock & { text: string }).text}
                      isStreaming={false}
                      workingDirectory={workingDirectory}
                    />
                  );

                case "thinking":
                  return (
                    <ThinkingBlock
                      key={renderBlock.id ?? `thinking-${index}`}
                      content={(block as ContentBlock & { thinking: string }).thinking}
                      threadId={threadId}
                      blockKey={renderBlock.id ?? `thinking-${index}`}
                    />
                  );

                case "tool_use":
                  return (
                    <ToolBlockRouter
                      key={(block as ContentBlock & { id: string }).id}
                      toolUseId={(block as ContentBlock & { id: string }).id}
                      toolName={(block as ContentBlock & { name: string }).name}
                      toolInput={(block as ContentBlock & { input: unknown }).input as Record<string, unknown>}
                    />
                  );

                case "server_tool_use":
                  return (
                    <ServerToolUseRenderer
                      key={(block as ServerToolUseBlock).id}
                      block={block as ServerToolUseBlock}
                      content={content as ContentBlock[]}
                    />
                  );

                case "web_search_tool_result":
                  // Handled by server_tool_use case — skip to avoid duplicate rendering
                  return null;

                default:
                  return null;
              }
            })}
          </div>
        </div>
      </article>
    </WorkspaceRootProvider>
  );
});

/** Renders server-side tool use blocks (e.g., web_search). */
function ServerToolUseRenderer({
  block,
  content,
}: {
  block: ServerToolUseBlock;
  content: ContentBlock[];
}) {
  const { threadId } = useThreadContext();

  // Find the corresponding web_search_tool_result block in the content array
  const resultBlock = content.find(
    (b): b is WebSearchToolResultBlock =>
      b.type === "web_search_tool_result" &&
      (b as WebSearchToolResultBlock).tool_use_id === block.id,
  ) as WebSearchToolResultBlock | undefined;

  const hasResult = !!resultBlock;
  const isError =
    resultBlock?.content &&
    !Array.isArray(resultBlock.content) &&
    (resultBlock.content as { type?: string }).type === "web_search_tool_result_error";

  const resultString = resultBlock ? JSON.stringify(resultBlock.content) : undefined;

  // server_tool_use is always web_search — pass server overrides directly
  const normalized = block.name.toLowerCase();
  if (normalized === "web_search" || normalized === "websearch") {
    return (
      <WebSearchToolBlock
        id={block.id}
        name={block.name}
        input={block.input as Record<string, unknown>}
        threadId={threadId}
        serverResult={resultString}
        serverIsError={isError ? true : false}
        serverStatus={hasResult ? "complete" : "running"}
      />
    );
  }

  // Fallback for any other server_tool_use type
  return (
    <ToolUseBlock
      id={block.id}
      name={block.name}
      input={block.input as Record<string, unknown>}
      threadId={threadId}
    />
  );
}
