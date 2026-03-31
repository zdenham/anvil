# LaTeX Math Rendering Support

Add `$$...$$` (display) and `$...$` (inline) math rendering to the thread view markdown renderer.

## Context

- **Thread view** (`src/components/thread/markdown-renderer.tsx`): Uses `react-markdown` with remark/rehype plugin pipeline. Adding math is a standard plugin combo: `remark-math` (parses `$`/`$$` delimiters) + `rehype-katex` (renders to HTML).
- **No existing math support** — no KaTeX, MathJax, or remark-math in the dependency tree today.

## Phases

- [x] Install dependencies and add KaTeX CSS

- [x] Add math to thread view markdown renderer

- [ ] Test rendering

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Install dependencies and add KaTeX CSS

Install npm packages:

```bash
pnpm add katex remark-math rehype-katex
pnpm add -D @types/katex
```

Import KaTeX CSS globally. Add to `src/index.css` or the app entrypoint:

```ts
import "katex/dist/katex.min.css";
```

## Phase 2: Add math to thread view markdown renderer

**File**: `src/components/thread/markdown-renderer.tsx`

1. Add imports:

   ```ts
   import remarkMath from "remark-math";
   import rehypeKatex from "rehype-katex";
   ```

2. Add `remarkMath` to the `remarkPlugins` array (before `remarkGfm` is fine):

   ```tsx
   remarkPlugins={[remarkMath, remarkGfm, remarkAlert]}
   ```

3. Add `rehypeKatex` to the `rehypePlugins` array. It must come **before** `rehypeSanitize` since sanitize would strip KaTeX's generated HTML. Alternatively, extend the sanitize schema to allowlist KaTeX's elements/classes/attributes. The simpler approach: place `rehypeKatex` after `rehypeRaw` but before `rehypeSanitize`, and extend the sanitize schema:

   ```tsx
   rehypePlugins={[rehypeRaw, rehypeKatex, [rehypeSanitize, mathSanitizeSchema]]}
   ```

4. Extend the sanitize schema to allow KaTeX output. KaTeX generates `<span>` elements with specific classes and inline styles. The schema needs to allow:

   - `span` with `className` patterns matching `katex*`, `mord`, `mbin`, `mrel`, `mopen`, `mclose`, `mpunct`, `minner`, `mfrac`, `msqrt`, `mspace`, `strut`, `base`, `vlist*`, etc.
   - `span` with `style` attribute (KaTeX uses inline styles for positioning)
   - `math`, `semantics`, `annotation`, `mi`, `mo`, `mn`, `ms`, `mrow`, `msup`, `msub`, `mfrac`, `msqrt`, `mroot`, `mover`, `munder`, `mtable`, `mtr`, `mtd` (MathML elements)

   **Simpler alternative**: Since KaTeX output is generated server-side (in our remark/rehype pipeline, not from user HTML), we can trust it. Use `rehype-katex` *after* sanitize, or restructure so sanitize only runs on the raw HTML pass. The cleanest approach: run `rehypeKatex` **after** `rehypeSanitize` so it operates on already-sanitized content and its output isn't stripped:

   ```tsx
   rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
   ```

   This works because `remark-math` creates MDAST math nodes (not raw HTML), and `rehype-katex` transforms those nodes into HTML after sanitization has already run on `rehypeRaw` output. **This is the recommended approach.**

## Phase 3: Test rendering

- Verify `$$\text{comp}_{\mathbf{b}}\;\mathbf{a} = \frac{\mathbf{a} \cdot \mathbf{b}}{|\mathbf{b}|}$$` renders correctly in thread messages
- Verify inline `$x^2$` renders correctly in thread messages
- Verify KaTeX CSS loads (proper fonts, spacing)
- Verify `rehypeSanitize` doesn't strip KaTeX output in thread view