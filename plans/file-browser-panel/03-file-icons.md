# 03 — File Type Icons

**Parallel track C** — no dependencies on other sub-plans. Can run simultaneously with 01 and 02.

See [decisions.md](./decisions.md) for rationale on using VS Code Material Icon Theme.

## Phases

- [ ] Install `material-icon-theme` npm dependency
- [ ] Create icon manifest module (build the lookup data from `generateManifest()`)
- [ ] Create icon resolver module (public API consumed by file browser)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Install dependency

```bash
pnpm add material-icon-theme
```

**What the package provides:**

- 1,136 SVG icon files at `node_modules/material-icon-theme/icons/` (e.g., `typescript.svg`, `folder-src.svg`, `folder-src-open.svg`)
- A `generateManifest()` function that returns the complete VS Code icon theme manifest — the exhaustive mapping from file extensions, filenames, folder names, and language IDs to icon definition IDs
- MIT license

**No `exports` field** in the package's `package.json`, so Vite can resolve deep imports like `material-icon-theme/icons/typescript.svg` without issues.

**Note on module format:** The package ships as CJS (`"module": "./dist/module/index.cjs"`). Vite's dependency pre-bundling (esbuild) handles CJS-to-ESM conversion automatically, so `import { generateManifest } from "material-icon-theme"` works in our ESM project without extra config.

## Phase 2: Create icon manifest module

**New file: `src/components/file-browser/icon-manifest.ts`**

This module calls `generateManifest()` once at import time to build lookup maps. The manifest is a VS Code icon theme manifest object with this shape:

```typescript
// Returned by generateManifest() — these are the fields we use:
// {
//   file: string                                  // default file icon ID (e.g., "file")
//   folder: string                                // default closed-folder icon ID
//   folderExpanded: string                         // default open-folder icon ID
//   iconDefinitions: Record<string, { iconPath: string }>  // icon ID -> relative SVG path
//   fileExtensions: Record<string, string>         // extension (no dot) -> icon ID
//   fileNames: Record<string, string>              // exact filename -> icon ID
//   folderNames: Record<string, string>            // folder name -> icon ID
//   folderNamesExpanded: Record<string, string>    // folder name -> open icon ID
// }
```

The `iconPath` values in `iconDefinitions` are relative paths like `./icons/typescript.svg`. We strip the `./` prefix and prepend `material-icon-theme/` to build a Vite-resolvable import path.

### Implementation outline (~60 lines)

```typescript
import { generateManifest } from "material-icon-theme";
import type { Manifest } from "material-icon-theme";

const manifest: Manifest = generateManifest();

/**
 * Convert the manifest's relative iconPath (e.g., "./icons/typescript.svg")
 * to a node_modules-resolvable path (e.g., "material-icon-theme/icons/typescript.svg").
 */
function resolveIconPath(iconId: string): string {
  const def = manifest.iconDefinitions?.[iconId];
  if (!def?.iconPath) return "";
  // iconPath is "./icons/foo.svg" — strip leading "./"
  return `material-icon-theme/${def.iconPath.replace(/^\.\//, "")}`;
}

// Pre-resolve the three fallback icon paths
const defaultFileIconPath = resolveIconPath(manifest.file ?? "");
const defaultFolderIconPath = resolveIconPath(manifest.folder ?? "");
const defaultFolderExpandedIconPath = resolveIconPath(manifest.folderExpanded ?? "");

// Export the manifest data + resolver for use by the icon resolver module
export {
  manifest,
  resolveIconPath,
  defaultFileIconPath,
  defaultFolderIconPath,
  defaultFolderExpandedIconPath,
};
```

**Key points:**
- `generateManifest()` is called once at module load — it is synchronous and pure (no I/O)
- The manifest already contains the exhaustive mapping of 377+ file extensions, 50+ special filenames, and 60+ folder names — no need to duplicate this in our code
- The `iconPath` values include a config hash suffix (e.g., `./icons/typescript.clone.svg`) for some icon packs; with default config (no `activeIconPack`), standard icons have no hash

## Phase 3: Create icon resolver module

**New file: `src/components/file-browser/file-icons.ts`**

Public API consumed by the file browser component. Resolves a filename or folder name to a Vite-importable SVG URL.

### SVG loading strategy

Vite cannot statically analyze dynamic imports with fully dynamic paths. Instead, use `new URL(..., import.meta.url)` or eagerly import via `import.meta.glob` for the subset of icons actually needed. The recommended approach:

**Option A — Dynamic URL construction (simpler, works at dev time and build):**

Since SVGs in `node_modules` are served as static assets by Vite's dev server and bundled as assets during build, construct URLs at runtime:

```typescript
function createIconUrl(modulePath: string): string {
  // In dev, Vite resolves node_modules paths via /@fs/ or its dependency pre-bundling
  // In build, we need the SVGs to be treated as assets
  // Use new URL() with import.meta.url for reliable resolution
  return new URL(`/node_modules/${modulePath}`, import.meta.url).href;
}
```

**However**, this approach does not work in production builds because `node_modules` is not copied to the output. The correct approach:

**Option B — Copy icons to `public/` at install time (recommended):**

Add a `postinstall` script that copies the SVG icons from `node_modules/material-icon-theme/icons/` into `public/material-icons/`:

```json
{
  "scripts": {
    "postinstall": "cp -r node_modules/material-icon-theme/icons public/material-icons"
  }
}
```

Then the resolver returns paths relative to the public directory:

```typescript
function createIconUrl(iconFileName: string): string {
  return `/material-icons/${iconFileName}`;
}
```

This works in both dev and production because Vite serves `public/` as-is.

**Option C — Vite `import.meta.glob` (recommended, no postinstall):**

Use `import.meta.glob` to eagerly import all SVGs from the package at build time. Vite will hash and include them in the bundle:

```typescript
// Eagerly import all SVGs — Vite processes them as assets with hashed filenames
const iconModules = import.meta.glob(
  "/node_modules/material-icon-theme/icons/*.svg",
  { query: "?url", import: "default", eager: true }
) as Record<string, string>;
```

This gives a `Record<string, string>` mapping glob paths to resolved asset URLs (hashed in prod). Then resolve by icon filename:

```typescript
function getIconUrl(iconFileName: string): string {
  const key = `/node_modules/material-icon-theme/icons/${iconFileName}`;
  return iconModules[key] ?? "";
}
```

**Decision: Use Option B (copy to `public/`).**

Rationale:
- `import.meta.glob` on 1,136 SVGs would bloat the bundle and slow builds
- `public/` copy is simple, predictable, and keeps SVGs out of the JS bundle
- The `postinstall` script runs once after `pnpm install`
- SVGs are served as static files with proper caching

### Implementation outline (~80 lines)

```typescript
import {
  manifest,
  resolveIconPath,
  defaultFileIconPath,
  defaultFolderIconPath,
  defaultFolderExpandedIconPath,
} from "./icon-manifest";

/** Base URL path for icon assets copied to public/ */
const ICON_BASE = "/material-icons";

/**
 * Extract just the SVG filename from a resolved module path.
 * E.g., "material-icon-theme/icons/typescript.svg" -> "typescript.svg"
 */
function toIconUrl(modulePath: string): string {
  if (!modulePath) return "";
  const filename = modulePath.split("/").pop() ?? "";
  return `${ICON_BASE}/${filename}`;
}

/**
 * Get the icon URL for a file by its name.
 *
 * Lookup order:
 * 1. Exact filename match (e.g., "package.json", "Dockerfile")
 * 2. File extension match (e.g., "ts", "rs", "md")
 * 3. Fallback to generic file icon
 */
export function getFileIconUrl(filename: string): string {
  const lower = filename.toLowerCase();

  // 1. Exact filename match
  const fileNameIconId = manifest.fileNames?.[lower];
  if (fileNameIconId) {
    return toIconUrl(resolveIconPath(fileNameIconId));
  }

  // 2. Extension match — try longest extension first (e.g., "d.ts" before "ts")
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    const extIconId = manifest.fileExtensions?.[ext];
    if (extIconId) {
      return toIconUrl(resolveIconPath(extIconId));
    }
  }

  // 3. Fallback
  return toIconUrl(defaultFileIconPath);
}

/**
 * Get the icon URL for a folder by its name.
 *
 * Returns the closed-folder variant. For expanded state,
 * use `getFolderIconUrl(name, true)`.
 */
export function getFolderIconUrl(
  folderName: string,
  expanded = false
): string {
  const lower = folderName.toLowerCase();
  const lookup = expanded
    ? manifest.folderNamesExpanded
    : manifest.folderNames;
  const iconId = lookup?.[lower];

  if (iconId) {
    return toIconUrl(resolveIconPath(iconId));
  }

  const fallback = expanded
    ? defaultFolderExpandedIconPath
    : defaultFolderIconPath;
  return toIconUrl(fallback);
}
```

### Rendering in React

The file browser component renders icons as `<img>` elements (same pattern as `app-icon.tsx`):

```tsx
<img
  src={getFileIconUrl(entry.name)}
  alt=""
  width={16}
  height={16}
  className="flex-shrink-0"
/>
```

Using `<img>` with SVG URLs keeps rendering simple and avoids `dangerouslySetInnerHTML`.

---

## Files

| File | Action |
|------|--------|
| `package.json` | Modify — add `material-icon-theme` dependency, add `postinstall` copy script |
| `.gitignore` | Modify — add `public/material-icons/` (generated, not committed) |
| `src/components/file-browser/icon-manifest.ts` | **New** — manifest generation + path resolver (~60 lines) |
| `src/components/file-browser/file-icons.ts` | **New** — public API: `getFileIconUrl()`, `getFolderIconUrl()` (~80 lines) |
