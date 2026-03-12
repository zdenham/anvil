# GitHub Markdown Rendering Support

## Problem

GitHub PR bodies and review comments contain syntax that our `MarkdownRenderer` doesn't handle properly:

1. **HTML comments** (`<!-- CURSOR_SUMMARY -->`, `<!-- DESCRIPTION START -->`, etc.) — rendered as visible text instead of being hidden
2. **GitHub admonitions** (`> [!NOTE]`, `> [!WARNING]`, etc.) — rendered as plain blockquotes with literal `[!NOTE]` text
3. **Raw HTML** (`<div>`, `<sup>`, `<picture>`, etc.) — not rendered as HTML (react-markdown strips raw HTML by default)

Affected components:

- `src/components/content-pane/pr-description-section.tsx` — renders PR body
- `src/components/content-pane/pr-comments-section.tsx` — renders review comment bodies

Both pass raw GitHub API content directly to `MarkdownRenderer`.

## Real-world format examples

**PR body** (from Cursor Bugbot):

```markdown
## Summary
...text...

<!-- CURSOR_SUMMARY -->
---
> [!NOTE]
> **Medium Risk**
> Changes expected-credit computation...
>
> <sup>Written by [Cursor Bugbot](https://cursor.com/dashboard?tab=bugbot)...</sup>
<!-- /CURSOR_SUMMARY -->
```

**Review comments** (from Cursor Bugbot):

```markdown
### Title

**Medium Severity**

<!-- DESCRIPTION START -->
Description text here.
<!-- DESCRIPTION END -->

<!-- BUGBOT_BUG_ID: uuid-here -->

<!-- LOCATIONS START
file.ts#L158-L163
LOCATIONS END -->
<div><a href="..."><picture>...</picture></a></div>
```

## Phases

- [x] Strip HTML comments and add GitHub admonition support to MarkdownRenderer

- [x] Add tests using real GitHub comment format fixtures

- [x] Handle raw HTML rendering (rehype-raw + sanitize)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Strip HTML comments + GitHub admonitions

### HTML comment stripping

Add a preprocessing step in `MarkdownRenderer` to strip HTML comments before passing content to react-markdown.

In `markdown-renderer.tsx`, update the `processedContent` useMemo:

```ts
// Strip HTML comments (<!-- ... -->) that GitHub bots inject
const stripped = content.replace(/<!--[\s\S]*?-->/g, "");
const linked = resolvedWorkingDirectory ? autoLinkFilePaths(stripped) : stripped;
```

This regex handles single-line and multi-line comments (including the `<!-- LOCATIONS START\n...\nLOCATIONS END -->` pattern).

### GitHub admonitions

Add `remark-github-blockquote-alert` (or similar lightweight plugin) to convert `> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!CAUTION]` into styled callout blocks.

```bash
pnpm add remark-github-blockquote-alert
```

Then in `markdown-renderer.tsx`:

```ts
import remarkAlert from "remark-github-blockquote-alert";
// ...
<ReactMarkdown remarkPlugins={[remarkGfm, remarkAlert]} components={components}>
```

Add minimal CSS/component overrides to style the callout blocks to match our dark theme (surface colors, subtle left border like existing comment styling).

**Alternative**: If the plugin is too heavy or has compatibility issues, write a lightweight custom remark plugin that transforms the `[!NOTE]` blockquote pattern into a styled `div`. The pattern is simple — detect blockquotes whose first child starts with `[!NOTE]` etc.

## Phase 2: Tests

Add test cases to `markdown-renderer.ui.test.tsx` using fixtures based on the real GitHub API format.

**Test cases:**

1. **HTML comments are stripped** — render content with `<!-- CURSOR_SUMMARY -->...<!-- /CURSOR_SUMMARY -->` and assert the comment markers don't appear in output
2. **Multi-line HTML comments** — `<!-- LOCATIONS START\nfile.ts#L1\nLOCATIONS END -->` should not render
3. **Content between comments preserved** — text outside comments still renders
4. **GitHub admonition renders** — `> [!NOTE]\n> Some text` renders as a styled callout, not literal `[!NOTE]` text
5. **Mixed format (full Bugbot comment)** — use the real review comment format as a fixture and assert only meaningful content is visible

Fixture approach: define const strings with the exact format from the GitHub API (captured above) and use them as test inputs.

## Phase 3: Raw HTML support

Add `rehype-raw` to properly parse inline HTML from GitHub comments, plus `rehype-sanitize` to prevent XSS:

```bash
pnpm add rehype-raw rehype-sanitize
```

```ts
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
// ...
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkAlert]}
  rehypePlugins={[rehypeRaw, rehypeSanitize]}
  components={components}
>
```

This enables:

- `<sup>` tags (used in Bugbot attribution)
- `<div>` wrappers
- `<a>` links with images (Cursor "Fix in Cursor" buttons)

The sanitizer will strip dangerous elements (scripts, iframes, event handlers) while allowing safe HTML.

**Note**: After adding `rehype-raw`, verify the HTML comment stripping still works — `rehype-raw` may handle comments differently. The preprocessing regex approach ensures they're stripped before any parser sees them, so this should be safe.

Add tests for:

- `<sup>` renders as superscript
- Dangerous HTML (`<script>`, `onclick`) is sanitized
- `<img>` tags render (for Cursor buttons)