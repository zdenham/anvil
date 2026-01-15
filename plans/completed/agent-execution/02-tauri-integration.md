# Tauri Integration

Configures Tauri to spawn Node.js agent processes and stream their output.

**Entity Types:** Settings are managed via `src/entities/settings/` which persists `WorkspaceSettings` (including `anthropicApiKey`).

## Files Owned

- `src-tauri/Cargo.toml` - Add shell plugin dependency
- `src-tauri/src/lib.rs` - Register shell plugin
- `src-tauri/capabilities/default.json` - Add shell permissions
- `src-tauri/src/config.rs` - Add API key to workspace settings
- `src-tauri/tauri.conf.json` - Bundle agents directory
- `package.json` - Add shell plugin JS dependency, build scripts

## Implementation

### 1. Add shell plugin to Cargo.toml

```toml
[dependencies]
tauri-plugin-shell = "2"
```

### 2. Register shell plugin in lib.rs

Add to the plugin chain:

```rust
.plugin(tauri_plugin_shell::init())
```

### 3. Update capabilities/default.json

Add shell permissions to spawn node:

```json
{
  "identifier": "default",
  "windows": ["main", "spotlight", "clipboard"],
  "permissions": [
    // ... existing permissions ...
    {
      "identifier": "shell:allow-spawn",
      "allow": [
        {
          "name": "node",
          "cmd": "node",
          "args": true
        }
      ]
    },
    "shell:allow-stdin-write",
    "shell:allow-kill"
  ]
}
```

**Note:** `args: true` allows any arguments. The `cwd` is handled at runtime via `SpawnOptions`, not restricted by permissions.

### 4. Add API key to workspace settings

**src-tauri/src/config.rs:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSettings {
    #[serde(default)]
    pub repository: Option<String>,
    /// Anthropic API key for agent execution
    #[serde(default)]
    pub anthropic_api_key: Option<String>,
}
```

### 5. Bundle agents directory

**src-tauri/tauri.conf.json:**

Add to the bundle resources:

```json
{
  "bundle": {
    "resources": [
      "agents/dist/**"
    ]
  }
}
```

### 6. Update package.json

Add JS dependencies and build scripts:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "@tauri-apps/plugin-shell": "^2"
  },
  "devDependencies": {
    "concurrently": "^8"
  },
  "scripts": {
    "dev": "concurrently \"pnpm dev:agents\" \"vite\"",
    "dev:agents": "cd agents && pnpm build --watch",
    "build": "pnpm build:agents && tsc && vite build",
    "build:agents": "cd agents && pnpm build"
  }
}
```

**Note:** `@anthropic-ai/sdk` is installed explicitly so we can use its types throughout the frontend codebase.

### 7. Entity Integration (Already Done)

The settings entity already provides the API key. No additional service needed:

```typescript
// src/entities/settings/types.ts - Already exists
export interface WorkspaceSettings {
  repository: string | null;
  anthropicApiKey: string | null;
}

// Usage in frontend agent service:
import { settingsService } from "@/entities";

const settings = settingsService.get();
if (!settings.anthropicApiKey) {
  throw new Error("Anthropic API key not configured");
}
```

## Security Notes

- The spawned process runs in the user's repository directory with full file system access. This is intentional - the agent needs to read/write files.
- The `$HOME/**` scope in fs permissions allows conversation folders within any repository under home.
- API key is stored in workspace settings, not committed to git (the `.mort/` folder should be in `.gitignore`).

## Testing

1. Run `pnpm tauri dev`
2. Verify no capability errors in console
3. Verify shell plugin loads (check Tauri logs)
4. Test spawning a simple node command:
   ```typescript
   import { Command } from "@tauri-apps/plugin-shell";
   const cmd = Command.create("node", ["--version"]);
   const output = await cmd.execute();
   console.log(output.stdout);
   ```
