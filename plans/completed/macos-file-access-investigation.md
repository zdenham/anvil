# macOS File Access Investigation

## Problem

The app can't view or edit files on Desktop (and likely Documents/Downloads). An `Info.plist` was added to `src-tauri/` with macOS privacy usage descriptions, and `infoPlistPath` was added to `tauri.conf.json` to reference it. However, `infoPlistPath` is **not a valid Tauri config property**, causing the app to fail to start entirely.

## Root Cause of Startup Failure

```
Error `tauri.conf.json` error on `bundle > macOS`: Additional properties are not allowed ('infoPlistPath' was unexpected)
```

The Tauri CLI rejects the config and exits immediately, so no window ever appears.

## Investigation Findings

### The Info.plist Approach is Correct

The `src-tauri/Info.plist` file contains the right macOS privacy descriptions:

- `NSDesktopFolderUsageDescription`
- `NSDocumentsFolderUsageDescription`
- `NSDownloadsFolderUsageDescription`

These are required for macOS to allow the app to access user folders. Without them, the OS silently denies access.

### How Tauri Discovers Info.plist

Tauri v2 **automatically discovers** `src-tauri/Info.plist` by convention and merges it into the generated Info.plist at build time. **No config key is needed** — just having the file in `src-tauri/` is sufficient.

### The Config Key Was Wrong

- `infoPlistPath` (a path to a file) — **does not exist in any Tauri version**
- `infoPlist` (an inline dictionary) — **added in Tauri v2.9.0+** via [PR #14108](https://github.com/tauri-apps/tauri/pull/14108)

### Valid `bundle > macOS` Properties

| Property | Description |
| --- | --- |
| `minimumSystemVersion` | Min macOS version (default "10.13") |
| `entitlements` | Path to entitlements plist |
| `hardenedRuntime` | Boolean, default true |
| `frameworks` | Frameworks to bundle |
| `infoPlist` | (v2.9.0+) Inline Info.plist extensions as key-value pairs |

## Resolution

**Option A — Convention-based (works with all Tauri v2 versions)**:Keep `src-tauri/Info.plist` as-is and **remove** `infoPlistPath` from `tauri.conf.json`. Tauri auto-discovers the file. This is already done.

**Option B — Inline config (requires Tauri v2.9.0+)**:Replace the file with inline config in `tauri.conf.json`:

```json
"macOS": {
  "minimumSystemVersion": "10.15",
  "entitlements": "entitlements.plist",
  "infoPlist": {
    "NSDesktopFolderUsageDescription": "Anvil needs access to your Desktop folder to read and manage code repositories.",
    "NSDocumentsFolderUsageDescription": "Anvil needs access to your Documents folder to read and manage code repositories.",
    "NSDownloadsFolderUsageDescription": "Anvil needs access to your Downloads folder to read and manage code repositories."
  }
}
```

## Current Status

- `infoPlistPath` has been removed from `tauri.conf.json` (Option A)
- `src-tauri/Info.plist` still exists and will be auto-discovered by Tauri
- The app should now start AND have the correct macOS privacy descriptions for folder access

## Remaining Considerations

1. **Dev builds**: The privacy descriptions take effect in **production builds** (bundled .app). During `tauri dev`, the app runs unbundled and file access depends on the terminal's existing permissions.
2. **First launch**: Users will see macOS permission prompts on first access to Desktop/Documents/Downloads. This is expected.
3. **Testing**: To verify the fix works end-to-end, build a release bundle (`pnpm tauri build`) and check that the generated `.app`'s Info.plist contains the usage descriptions.