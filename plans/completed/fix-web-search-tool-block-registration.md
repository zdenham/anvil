# Fix: WebSearchToolBlock Not Rendering

## Diagnosis

The `WebSearchToolBlock` component exists and is properly imported in the registry (`src/components/thread/tool-blocks/index.ts:22`), but it's never being used. The root cause is a **mismatch between the block type and the switch statement handling**.

### The Problem

1. **Registry is correct**: The tool block registry maps `web_search` (with underscore) to `WebSearchToolBlock`:
   ```typescript
   // src/components/thread/tool-blocks/index.ts:68
   web_search: WebSearchToolBlock,
   ```

2. **Block type is different**: The Anthropic SDK defines web search as a **`ServerToolUseBlock`** with `type: 'server_tool_use'`, NOT a regular `ToolUseBlock` with `type: 'tool_use'`:
   ```typescript
   // From @anthropic-ai/sdk/src/resources/messages/messages.ts:633-641
   export interface ServerToolUseBlock {
     id: string;
     input: unknown;
     name: 'web_search';       // <-- tool name
     type: 'server_tool_use';  // <-- block type (NOT 'tool_use')
   }
   ```

3. **Switch statement misses it**: The `AssistantMessage` component only handles `case "tool_use"`:
   ```typescript
   // src/components/thread/assistant-message.tsx:51-147
   switch (block.type) {
     case "text": ...
     case "thinking": ...
     case "tool_use": {
       // Only handles regular tool_use blocks
       const SpecializedBlock = getSpecializedToolBlock(block.name);
       ...
     }
     default:
       return null;  // server_tool_use falls through here!
   }
   ```

4. **Result**: When a `ServerToolUseBlock` (web_search) comes through, it hits the `default` case and returns `null`, so nothing is rendered.

### Additional Missing Type

The SDK's `ContentBlock` union type also includes `WebSearchToolResultBlock` which should be rendered alongside the tool use:
```typescript
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ServerToolUseBlock          // <-- web_search tool call
  | WebSearchToolResultBlock    // <-- web_search results
  | ThinkingBlock
  | RedactedThinkingBlock;
```

## Proposed Fix

### Option A: Add case for `server_tool_use` (Recommended)

Add a new case in `assistant-message.tsx` to handle `server_tool_use` blocks:

```typescript
// In the switch statement, add:
case "server_tool_use": {
  // ServerToolUseBlock has same shape as ToolUseBlock for our purposes
  const state = toolStates?.[block.id] ?? { status: "running" as const };

  // Use the specialized block (web_search is the only server tool currently)
  const SpecializedBlock = getSpecializedToolBlock(block.name);
  if (SpecializedBlock) {
    return (
      <SpecializedBlock
        key={block.id}
        id={block.id}
        name={block.name}
        input={block.input as Record<string, unknown>}
        result={state.result}
        isError={state.isError}
        status={state.status}
        threadId={threadId}
      />
    );
  }

  // Fallback to generic tool block
  return (
    <ToolUseBlock
      key={block.id}
      id={block.id}
      name={block.name}
      input={block.input as Record<string, unknown>}
      result={state.result}
      isError={state.isError}
      status={state.status}
      threadId={threadId}
    />
  );
}
```

### Option B: Also handle WebSearchToolResultBlock

If web search results come as separate `web_search_tool_result` blocks (need to verify), add another case or integrate the results into the `server_tool_use` handler.

## Files to Modify

1. **`src/components/thread/assistant-message.tsx`** - Add `case "server_tool_use"` to the switch statement

2. **Optionally update type imports** - Import `ServerToolUseBlock` type for better type safety

## Verification Steps

1. Trigger a web search in the app (use the WebSearch tool)
2. Observe that the `WebSearchToolBlock` component renders instead of nothing
3. Check that results display correctly when the search completes

## Notes

- The `ServerToolUseBlock` currently only supports `web_search` (the `name` field is a literal type `'web_search'`)
- Future Anthropic server-side tools would likely also use `server_tool_use` block type
- The registry key `web_search` (with underscore) is correct and matches the SDK
