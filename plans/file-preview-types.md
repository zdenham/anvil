# Broader File Type Preview Support

## Problem

When clicking files in the sidebar, the `FileContent` component only handles two categories:
1. **Text/code files** → syntax-highlighted view via Shiki
2. **Markdown** → rendered markdown with source toggle

Everything else (images, PDFs, SVGs rendered visually, etc.) either shows as raw XML/text or hits the "Binary file — cannot display" error. PNGs were specifically requested, but there's a broader gap.

## Current Architecture

```
FileContent (src/components/content-pane/file-content.tsx)
  ├── reads file via FilesystemClient.readFile() [Rust fs::read_to_string — text only]
  ├── binary detection: checks for \0 bytes → "Binary file — cannot display"
  ├── language detection: getLanguageFromPath() → Shiki language ID
  ├── markdown/mdx → MarkdownRenderer (rendered + source toggle)
  └── everything else → HighlightedFileView (syntax highlighting)
```

**Key constraint**: `fs_read_file` in Rust uses `fs::read_to_string`, which fails on binary files. For images/PDFs we can't go through this path at all.

**Key enabler**: Tauri's `protocol-asset` feature is already enabled with `scope: ["**"]`, and `@tauri-apps/api` v2 is installed. This means we can use `convertFileSrc()` to get `asset://` URLs for binary files — no new Rust commands needed.

## File Types to Add

### Tier 1 — High value, common in codebases
| Type | Extensions | Approach |
|------|-----------|----------|
| **Raster images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico` | `<img>` with `convertFileSrc()` asset URL |
| **SVG** (visual) | `.svg` | Currently renders as XML. Add visual render mode with rendered/source toggle (like markdown) |
| **PDF** | `.pdf` | `<iframe>` or `<embed>` with asset URL |

### Tier 2 — Nice to have, low effort with same pattern
| Type | Extensions | Approach |
|------|-----------|----------|
| **Video** | `.mp4`, `.webm`, `.mov` | `<video>` with asset URL |
| **Audio** | `.mp3`, `.wav`, `.ogg`, `.m4a` | `<audio>` with asset URL |
| **Fonts** | `.woff`, `.woff2`, `.ttf`, `.otf` | Preview panel showing sample text at multiple sizes |

### Not adding (diminishing returns)
- `.zip`, `.tar`, `.gz` — no meaningful inline preview
- `.psd`, `.sketch`, `.fig` — need specialized decoders
- `.docx`, `.xlsx` — need heavy libraries
- `.wasm` — already has syntax highlighting as hex/text

## Implementation Plan

### Approach

Introduce a **file category** concept upstream of language detection. Before trying to read the file as text, classify it by extension into one of: `image`, `svg`, `pdf`, `video`, `audio`, `text`. Binary categories skip the `readFile` call entirely and use `convertFileSrc()` to get an asset protocol URL.

### File changes

**1. New file: `src/lib/file-categories.ts`**
- `getFileCategory(filePath)` → returns `"image" | "svg" | "pdf" | "video" | "audio" | "text"`
- Extension-based lookup maps for each category
- Exported `isMediaFile()` helper for quick binary check

**2. Edit: `src/components/content-pane/file-content.tsx`**
- Import `getFileCategory` and `convertFileSrc` from `@tauri-apps/api/core`
- Before `loadFile()`, check category. If non-text, skip `readFile` and set a new state variant
- Add `FileState` variant: `{ status: "media"; category: string; assetUrl: string }`
- Render media categories:
  - `image` → `<ImagePreview url={assetUrl} />`
  - `svg` → rendered `<img>` with source toggle (reuse `ViewModeToggle`, source mode reads as text)
  - `pdf` → `<embed src={assetUrl} type="application/pdf" />`
  - `video` → `<video controls src={assetUrl} />`
  - `audio` → `<audio controls src={assetUrl} />`

**3. Edit: `src/lib/language-detection.ts`**
- Remove `.svg` → `"xml"` mapping (SVG gets its own visual renderer now, with XML as source view)

### Component structure (within file-content.tsx)

Keep it simple — no new files for individual renderers. Each media type is a small inline component:

```tsx
function ImagePreview({ url, filePath }: { url: string; filePath: string }) {
  // Centered image with max-width/max-height constraints, checkerboard bg for transparency
}

function PdfPreview({ url }: { url: string }) {
  // Full-height embed
}

function VideoPreview({ url }: { url: string }) {
  // Centered video with native controls
}

function AudioPreview({ url }: { url: string }) {
  // Centered audio player
}
```

SVG uses the existing `ViewModeToggle` pattern — "Rendered" shows `<img src={assetUrl}>`, "Source" loads text and shows `HighlightedFileView` with XML highlighting.

## Phases

- [ ] Create `src/lib/file-categories.ts` with extension maps and `getFileCategory()`
- [ ] Update `file-content.tsx` — add media state, category-based routing, image/svg/pdf/video/audio renderers
- [ ] Update `language-detection.ts` — remove svg→xml mapping (svg handled as visual now)
- [ ] Manual smoke test with sample files to verify each type works

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- No new Rust commands needed — `convertFileSrc()` + existing asset protocol covers binary files
- SVG is dual-mode: it's both a visual format and valid XML source, so it gets the rendered/source toggle like markdown
- Font preview is listed as Tier 2 but can be deferred — it needs `@font-face` injection which is slightly more involved
- The `isBinaryContent()` null-byte check can remain as a fallback for unknown binary files that slip through
