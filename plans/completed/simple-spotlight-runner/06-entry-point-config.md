# 06 - Entry Point & Configuration

**Parallelizable:** Yes (no dependencies)
**Estimated scope:** 2 files created, 2 files modified

## Overview

Create the HTML entry point and update build configuration for the simple task window.

## Tasks

### 1. Create HTML entry point

**File:** `simple-task.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Simple Task</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/simple-task-main.tsx"></script>
  </body>
</html>
```

### 2. Create React entry point

**File:** `src/simple-task-main.tsx`

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SimpleTaskWindow } from "./components/simple-task/simple-task-window";
import { hydrateEntities } from "./entities";
import "./index.css"; // Or a specific simple-task.css

async function bootstrap() {
  await hydrateEntities();
}

bootstrap().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SimpleTaskWindow />
    </StrictMode>
  );
});
```

### 3. Update Vite config

**File:** `vite.config.ts`

Add the simple-task entry point to rollup inputs:

```typescript
import { resolve } from "path";

export default defineConfig({
  // ...
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        spotlight: resolve(__dirname, "spotlight.html"),
        task: resolve(__dirname, "task.html"),
        "simple-task": resolve(__dirname, "simple-task.html"), // ADD THIS
        // ... other entries
      },
    },
  },
});
```

### 4. Update Tauri config

**File:** `src-tauri/tauri.conf.json`

Add window configuration (optional, since windows are created dynamically):

```json
{
  "windows": [
    // ... existing windows
    {
      "label": "simple-task-template",
      "title": "Simple Task",
      "url": "simple-task.html",
      "visible": false,
      "width": 600,
      "height": 500,
      "resizable": true,
      "decorations": true
    }
  ]
}
```

Note: This template window is optional. The `open_simple_task` command creates windows dynamically with unique labels.

## Verification

```bash
pnpm build
# Verify dist/simple-task.html exists
# Verify dist/assets contains simple-task bundle
```
