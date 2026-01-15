# Phase 8: Entry Points & Configuration

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Low - do after all code updates, before final verification.

## HTML Entry Point

### conversation.html → thread.html

1. Rename the file
2. Update any internal references to "conversation"
3. Update `<title>` tag if present

## Vite Configuration

### vite.config.ts

```typescript
// Line 31: Update rollup input
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, "index.html"),
      spotlight: resolve(__dirname, "spotlight.html"),
      clipboard: resolve(__dirname, "clipboard.html"),
      thread: resolve(__dirname, "thread.html"),  // was: conversation
    },
  },
},

// Line 24: Update comment
// Multi-page app configuration for main, spotlight, clipboard, and thread windows
```

## Tauri Capabilities

### src-tauri/capabilities/default.json

```json
{
  "windows": [
    "main",
    "spotlight",
    "clipboard",
    "thread"    // was: "conversation"
  ],
  // ...
}
```

## CSS (if any conversation-specific styles)

### src/index.css

Check for conversation-related class names or comments.

## File Renames Summary

Execute after all content updates:
```bash
# HTML entry point
mv conversation.html thread.html

# Main entry point
mv src/conversation-main.tsx src/thread-main.tsx
```

## Verification

```bash
# Full build
pnpm build

# Check dist/ output has thread.html, not conversation.html
ls dist/
```

## Checklist

- [ ] Rename conversation.html → thread.html
- [ ] Update vite.config.ts rollup input
- [ ] Update src-tauri/capabilities/default.json windows array
- [ ] Check src/index.css for conversation refs
- [ ] Rename src/conversation-main.tsx → src/thread-main.tsx
- [ ] pnpm build passes
- [ ] dist/ contains thread.html
