# Tool Block Feedback

Collection of feedback items for tool call block UI/UX improvements.

---

## 10. Edit tool block icon - replace pencil with something better

**Feedback:** The pencil icon for the Edit tool block doesn't feel right. Need to explore alternative icon options.

**Investigation:**
- Current: `edit-tool-block.tsx` uses `Pencil` icon from lucide-react
- Alternative icons to consider:
  - `FileEdit` - file with pencil, more specific to file editing
  - `FileDiff` - file with +/- diff lines
  - `Replace` - two arrows in a cycle
  - `ArrowLeftRight` - horizontal swap arrows
  - `GitCompare` - git comparison style
  - `Diff` - generic diff icon
  - `FileCode` - file with code brackets
  - `FilePen` - similar to FileEdit
  - `PenLine` - pen with line underneath

**Fix Proposal:**
1. Review icon options visually in context
2. Pick one that conveys "text replacement" or "file modification" better than a generic pencil
3. Update the import and usage in `edit-tool-block.tsx`

---

## 9. Read tool block should show "Read [fileName]" with relative path on second line

**Feedback:** The Read tool block description should show "Read [fileName]" (e.g., "Read config.ts") in the header, with the relative path kept on the second line with the icon.

**Investigation:**
- `read-tool-block.tsx` line 58-63 currently shows "Reading file" / "Read file" as the description
- Line 76-83 shows the full relative path on the second line with FileText icon
- The file name could be extracted from `filePath` using `path.basename()` or string split

**Fix Proposal:**
1. Extract file name from path:
   ```typescript
   const fileName = filePath.split('/').pop() || filePath;
   ```
2. Update line 1 description:
   ```tsx
   <ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200 truncate">
     {isRunning ? `Reading ${fileName}` : `Read ${fileName}`}
   </ShimmerText>
   ```
3. Keep second line unchanged - relative path with FileText icon

---

## 8. Redundant/overlapping copy buttons across tool blocks

**Feedback:** The Search (Grep) output has two copy buttons which overlap each other. Investigate if there are other redundant copy buttons.

**Investigation:**
The agent found multiple instances of overlapping copy buttons:

1. **GrepToolBlock** - Most problematic:
   - Line 461: Header copy button for pattern
   - Line 468: Absolute positioned "Copy all results" at `top-1 right-1 z-10` inside expanded content
   - Line 497: Per-file path copy buttons
   - Line 527: Per-line match copy buttons
   - **Problem:** The absolute positioned "Copy all results" button overlaps with other UI elements

2. **EditToolBlock** - Nested absolute positioned buttons:
   - Line 142: Header copy button for file path
   - Lines 160-162, 172-174: Copy buttons inside CollapsibleOutputBlock for old/new strings
   - **Problem:** Absolute positioned buttons at `top-1 right-1 z-10` may overlap with collapse button

3. **TaskToolBlock, WebFetchToolBlock** - Same pattern:
   - Absolute positioned copy buttons at `top-1 right-1 z-10` inside CollapsibleOutputBlock
   - May conflict with collapse/expand button

**Fix Proposal:**
1. For **GrepToolBlock**: Remove the absolute positioned "Copy all results" button (line 468-471) - the per-file and per-line copy buttons are sufficient
2. For **EditToolBlock**: Position copy buttons inline rather than absolute, or ensure they don't overlap with collapse button
3. General pattern: Avoid absolute positioning copy buttons inside CollapsibleOutputBlock - use inline positioning instead
4. Review all uses of `absolute top-1 right-1 z-10` pattern in tool blocks

---

## 7. WebSearch tool links don't open in browser

**Feedback:** When clicking search result links in WebSearch tool block, they don't open in a new browser window. Expected behavior is to open links externally.

**Investigation:**
- `web-search-tool-block.tsx` lines 215-223 render the link:
  ```tsx
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    className="text-sm text-blue-400 hover:text-blue-300 hover:underline..."
    onClick={(e) => e.stopPropagation()}
  >
  ```
- The anchor tag has correct `target="_blank"` attribute
- However, in Tauri/Electron webview contexts, regular anchor tags may not open external browser
- Need to use Tauri's `shell.open()` API to open URLs in the system browser

**Fix Proposal:**
1. Import Tauri shell API:
   ```typescript
   import { open } from "@tauri-apps/plugin-shell";
   ```
2. Update the click handler to use shell.open:
   ```tsx
   <a
     href={url}
     target="_blank"
     rel="noopener noreferrer"
     className="..."
     onClick={(e) => {
       e.preventDefault();
       e.stopPropagation();
       open(url);
     }}
   >
   ```
3. Apply same fix to any other tool blocks that render external links (e.g., WebFetch)

---

## 6. Task tool block should say "Task agent" in the header

**Feedback:** The Task tool block just shows the description (e.g., "Find error handling") without indicating it's a task/subagent being launched. Should say "Task agent" or similar.

**Investigation:**
- `task-tool-block.tsx` line 157-162 renders the description directly as the first line text
- The second line (175-181) shows "Subagent task" as fallback, but this is the less prominent detail line
- Other tool blocks follow a pattern like "Read file", "Edit file", "Search" as the action verb on line 1
- For consistency, Task should show "Task agent" or "Run agent" on line 1, with description on line 2

**Fix Proposal:**
1. Change line 1 to show a consistent action label:
   ```tsx
   <ShimmerText isShimmering={isRunning} className="...">
     {isRunning ? "Running task agent" : "Task agent"}
   </ShimmerText>
   ```
2. Move the description to line 2 (where the prompt snippet currently is):
   ```tsx
   <div className="flex items-center gap-1 mt-0.5">
     <GitBranch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
     <span className="text-xs text-zinc-500 truncate">
       {description}
     </span>
   </div>
   ```
3. This matches the pattern: Line 1 = action type, Line 2 = specific details

---

## 5. Edit tool block should have syntax highlighting for old/new strings

**Feedback:** The Edit tool's diff display shows `old_string` and `new_string` as plain monospace text without syntax highlighting.

**Investigation:**
- `edit-tool-block.tsx` displays old/new strings in `<pre>` tags with red/green background colors (lines 159, 172)
- No syntax highlighting is applied to the code content
- The file path is available in `editInput.file_path`, which can be used to detect language
- Same highlighting infrastructure available: `getLanguageFromPath()`, `useCodeHighlight` hook, `CodeBlock` component

**Fix Proposal:**
1. Use `getLanguageFromPath(filePath)` to determine the language from the file being edited
2. Apply syntax highlighting to both `old_string` and `new_string` content:
   - Option A: Use `useCodeHighlight` hook and render tokens manually (preserves red/green backgrounds)
   - Option B: Create a variant of CodeBlock that accepts a background color override
3. Keep the red/green background tints but overlay syntax-highlighted tokens on top

---

## 4. Edit tool block "Result" section is unnecessary noise

**Feedback:** The Edit tool displays a "Result:" section that shows the tool's return message. This is usually just "File edited successfully" which is redundant - the success is already indicated by the status.

**Investigation:**
- `edit-tool-block.tsx` lines 179-191 render a result section whenever `result` is truthy
- For successful edits, this typically just echoes confirmation text
- For errors, it would show the error message (which IS useful)

**Fix Proposal:**
1. Only show the Result section when `isError === true`
2. Change from:
   ```tsx
   {result && (
     <div className="text-xs font-mono">
       <div className="text-zinc-500 mb-1">Result:</div>
       ...
     </div>
   )}
   ```
   To:
   ```tsx
   {isError && result && (
     <div className="text-xs font-mono">
       <div className="text-zinc-500 mb-1">Error:</div>
       ...
     </div>
   )}
   ```

---

## 3.5 WebFetch tool not displaying output content

**Feedback:** The WebFetch (Fetch URL) tool doesn't appear to display any output content when expanded.

**Investigation:**
- `web-fetch-tool-block.tsx` DOES have content rendering (lines 178-200)
- It parses JSON expecting `{"url": "...", "content": "...", "final_url": "..."}`
- Content is rendered as markdown using `ReactMarkdown`
- Possible issues:
  1. The result format might not match expected JSON structure
  2. The `content` field might be empty or missing in the actual response
  3. Parsing might fail and the fallback (line 47-51) treats raw string as content, but that may also be empty

**Fix Proposal:**
1. First, debug what the actual result format is - add console logging or check the raw result
2. If format differs from expected, update `parseWebFetchResult()` to handle it
3. Consider adding a "No content" message when expanded but content is empty (currently shows nothing)
4. If result is just a plain string (not JSON), display it directly

---

## 3. Grep (Search) tool output displays raw JSON instead of formatted file list

**Feedback:** The Grep tool in `files_with_matches` mode shows JSON like `{"mode":"files_with_matches","filenames":[...],"numFiles":17}` as one line instead of a nicely formatted list.

**Investigation:**
- `grep-tool-block.tsx` has extensive parsing for three output modes: `content`, `files_with_matches`, and `count` (lines 68-237)
- `parseFilesMode()` (lines 68-82) expects newline-separated file paths, not JSON
- The actual result is a JSON object: `{"mode": "files_with_matches", "filenames": [...], "numFiles": ...}`
- The parser splits by newlines and gets a single garbage line

**Fix Proposal:**
1. Update `parseGrepResult()` (around line 211) to detect JSON format first:
   ```typescript
   function parseGrepResult(result: string | undefined, input: GrepInput): ParsedGrepResult {
     const outputMode = input.output_mode ?? "content";

     if (!result) { /* existing empty handling */ }

     // Try to parse as JSON first
     try {
       const json = JSON.parse(result);
       if (json && Array.isArray(json.filenames)) {
         // Handle JSON format from tool
         const files = json.filenames.map((path: string) => ({
           path,
           matchCount: 1,
           matches: [],
         }));
         return {
           pattern: input.pattern,
           outputMode: json.mode || outputMode,
           files,
           totalMatches: files.length,
           totalFiles: files.length,
         };
       }
     } catch {
       // Not JSON, continue with existing parsing
     }

     // ... existing newline-based parsing
   }
   ```
2. This same pattern applies to all three modes - the JSON might contain match content too, so check for that structure

---

## 2. Glob tool output displays raw JSON instead of formatted file list

**Feedback:** The Glob (find files) tool shows JSON like `{"filenames":[...], "durationMs":361, "numFiles":19, "truncated":false}` rendered as one line instead of a nicely formatted bulleted list.

**Investigation:**
- `glob-tool-block.tsx` already has a `parseGlobResult()` function (lines 28-44) that handles JSON parsing
- The parser expects either:
  - A plain JSON array: `["path1", "path2"]`
  - Newline-separated text
- However, the actual result is a JSON object: `{"filenames": [...], "durationMs": ..., "numFiles": ..., "truncated": ...}`
- The parser tries `JSON.parse()`, gets an object (not an array), fails the `Array.isArray()` check, falls through to newline-split which produces garbage

**Fix Proposal:**
1. Update `parseGlobResult()` to handle the object format:
   ```typescript
   const parsed = JSON.parse(result);
   if (Array.isArray(parsed)) {
     return parsed.filter((p) => typeof p === "string");
   }
   // Handle object with filenames property
   if (parsed && Array.isArray(parsed.filenames)) {
     return parsed.filenames.filter((p) => typeof p === "string");
   }
   ```
2. Optionally extract and display the metadata (`durationMs`, `truncated`) in the UI if useful

---

## 1. Read file expanded content should have syntax highlighting

**Feedback:** When expanding a Read tool block, the file content should display with proper syntax highlighting based on the file extension.

**Investigation:**
- Current state: `read-tool-block.tsx` only shows error messages when expanded - it doesn't display the file content at all on success (lines 90-95)
- Syntax highlighting infrastructure already exists:
  - `src/lib/syntax-highlighter.ts` - Shiki-based highlighter with caching
  - `src/lib/language-detection.ts` - Maps file extensions to Shiki language identifiers (e.g., `.ts` → `typescript`, `.py` → `python`)
  - `src/components/thread/code-block.tsx` - Reusable `CodeBlock` component with highlighting, copy button, and expand/collapse for long content
  - `src/hooks/use-code-highlight.ts` - Hook for async syntax highlighting

**Fix Proposal:**
1. Update `read-tool-block.tsx` to display file content when expanded (not just errors)
2. Use `getLanguageFromPath()` from `language-detection.ts` to determine the language from `file_path`
3. Either:
   - **Option A:** Reuse the existing `CodeBlock` component for full-featured display (header with language, copy, expand/collapse)
   - **Option B:** Use `useCodeHighlight` hook directly for lighter-weight inline highlighting
4. Handle edge cases:
   - Binary files / image files (show placeholder or skip content display)
   - Very large files (leverage existing collapse threshold from CodeBlock)
   - Missing result content (already handled - shows nothing)

---

