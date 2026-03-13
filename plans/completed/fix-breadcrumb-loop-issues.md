# Fix Breadcrumb Loop Issues

Two bugs observed in the breadcrumb-loop + breadcrumb skill interaction (thread `ad521e52`):

## Problem 1: False-positive completion signal

The breadcrumb agent's final message said:

> "Not signaling `BREADCRUMB_COMPLETE` since manual testing hasn't been done."

The naive `result.includes("BREADCRUMB_COMPLETE")` check would match this — the agent mentioned the signal string while explicitly declining to use it. The loop would terminate prematurely.

**Fix — two changes:**

### A. Breadcrumb [SKILL.md](http://SKILL.md) (completion signal section)

Add a strict rule: **never write the completion signal string unless you are actually signaling completion.** Don't reference it, negate it, or discuss it. If you're not done, just don't mention it at all. Something like:

> **CRITICAL**: The string `BREADCRUMB_COMPLETE` is detected mechanically in your response. Never write it unless you are signaling true completion. Do not reference, negate, or discuss it (e.g., don't write "not signaling BREADCRUMB_COMPLETE") — just omit it entirely if you're not done.

### B. Breadcrumb-loop [SKILL.md](http://SKILL.md) (detection logic)

Tighten the check so it only matches an isolated signal, not a substring in a sentence. For example, check that the result ends with the signal or that it appears on its own line:

```js
if (result.trim().endsWith("BREADCRUMB_COMPLETE")) {
```

Or use a regex that requires it on its own line:

```js
if (/^BREADCRUMB_COMPLETE$/m.test(result)) {
```

Both changes together (strict prompt + robust check) provide defense in depth.

## Problem 2: Loop agent confusion after mort-repl completes

The breadcrumb sub-agents commit their work directly to the branch. When the mort-repl loop finishes (or is interrupted), the parent agent doesn't realize this — it checked `git diff` and saw nothing changed, then wrongly concluded "the breadcrumb agent didn't actually implement anything." It then attempted to redo all the work before eventually noticing the code was already there.

**Fix — add post-loop instructions to breadcrumb-loop [SKILL.md](http://SKILL.md):**

After the loop code block, add a section like:

> ## After the Loop
>
> Breadcrumb agents commit their work directly to the branch. When the loop finishes:
>
> 1. Run `git log --oneline` to see what the breadcrumb agents committed
> 2. Read the latest `*-progress.md` file in the breadcrumb directory for a summary
> 3. Report the results to the user — don't try to verify via `git diff` (it will be empty since everything is already committed)

## Phases

- [x] Update `plugins/mort/skills/breadcrumb/SKILL.md` — add strict rule about never mentioning the signal string unless signaling

- [x] Update `plugins/mort/skills/breadcrumb-loop/SKILL.md` — tighten the detection check and add post-loop instructions

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---