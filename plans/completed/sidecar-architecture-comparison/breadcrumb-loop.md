# breadcrumb-loop (azure-herring)

**Philosophy:** Incremental, well-tracked progress. Clean and pragmatic.

## Unique Decisions

- **Incremental commits (8)** — only implementation with proper git history
- `SidecarStateImpl` **class** — wraps all managers + projectRoot + port in a single state container with `dispose()`
- **Process group isolation** — uses `setpgid` in Rust to put sidecar in its own process group (cleanest Unix signal handling)
- **Separate** `mime.ts` — MIME type lookup extracted to own file
- **Global shortcut shim** — only implementation that stubs `@tauri-apps/plugin-global-shortcut`
- **Compact dispatch** — router is just 22 lines (smallest)
- **Express 5.1.0** — newest Express version (others use 4.x)

## Strengths

- No showstopper bugs
- Best git hygiene (8 incremental commits, honest progress tracking)
- Clean state management (SidecarStateImpl with dispose pattern)
- Process group isolation (proper Unix process management)
- Most Tauri plugin shims (including global-shortcut)
- Compact, readable codebase (\~2,405 lines)

## Weaknesses

- `execFileSync` in `fsGitWorktreeAdd/Remove` blocks event loop up to 30s
- No Zod validation at WS boundary (same as all others)
- `homeDir()` shim returns `"/"` instead of actual home directory
- Dead code: `AgentHubManager.hierarchy` map populated but never read
- `console.log` instead of structured logger (7 instances)