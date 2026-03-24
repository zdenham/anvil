# Landing Page

Create a minimal, text-driven landing page for Anvil (née Anvil). No images, no gradients, no hero illustrations — just big monospace text that alternates left/right justification to create visual rhythm. The tone is humorous and self-deprecating, telling the story of the pain of juggling worktrees and TUI agents before revealing what Anvil does.

## Design Principles

- **Monospace only.** One font family, multiple weights and sizes.
- **Alternating justification.** Sections alternate between left-aligned and right-aligned text blocks, creating a zig-zag reading pattern as you scroll.
- **Big and bold.** Headlines are oversized. Body text is still large. Whitespace is generous.
- **Black and white** (or near it). Maybe one accent color. Nothing else.
- **No JS frameworks.** Single HTML file with inline CSS. Maybe a `<style>` block. Ship it as a static page.

## Copy Direction

The page tells a story in \~6-8 short sections, scrolling vertically. Each section is a few lines max. The tone is: "we've all been there, it sucks, here's a thing that makes it suck less."

Example flow (rough — refine during implementation):

1. **Left-aligned, huge:** "You open a terminal. You clone the repo. You start an agent."
2. **Right-aligned:** "Then you need another one. So you open another terminal. Another worktree. Another agent."
3. **Left-aligned:** "Now you have six terminals. You can't remember which one is which. One of them is rebasing onto the wrong branch."
4. **Right-aligned:** "You alt-tab through them like a desperate air traffic controller who also writes code."
5. **Left-aligned:** "It shouldn't be this hard."
6. **Right-aligned, reveal:** "Anvil is a coding agent orchestrator. You run many agents in parallel, in isolated worktrees, from one window."
7. **Left-aligned:** "That's it. That's the product."
8. **Right-aligned, small:** A link to install or join waitlist. Keep it deadpan.

## Phases

- [ ] Write the copy — nail the tone, pacing, and section breaks

- [ ] Build the page — single HTML file with inline styles, monospace font, alternating alignment, responsive

- [ ] Deploy setup — decide hosting (GitHub Pages, Cloudflare Pages, or R2 static) and wire up

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Technical Notes

- Host candidates: GitHub Pages (simplest), Cloudflare Pages, or an R2 bucket (already in use for distribution scripts)
- Domain TBD — may want `anvil.dev` or similar, but that's outside this plan's scope
- The page should be a single `index.html` — no build step, no bundler
- Font: use `JetBrains Mono`, `IBM Plex Mono`, or `Berkeley Mono` via self-hosting or Google Fonts
- Responsive: text sizes scale down on mobile but the alternating pattern should still work (maybe narrower margins instead of full left/right swing)