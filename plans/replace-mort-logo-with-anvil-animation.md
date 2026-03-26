# Replace Mort Logo with Anvil Animation

## Goal

Remove the old mort face logo (`◠◡◠`) everywhere and replace the install script branding with a terminal-rendered version of the landing page anvil animation. The animation plays during the download, and the final frame shows **only the anvil** (no hammer/arm/sparks).

## Key Constraint

Keep `install.sh` clean and readable. The animation data and rendering logic live in a separate file — [install.sh](http://install.sh) stays short and focused on installation logic.

## Current State

- `scripts/installation/install.sh` — displays the mort face logo (`▄▀▀▀▄ / █ ◠◡◠ █ / ▀▄▄▄▀`) at the top, then does the download/install flow.
- `landing/src/data/frames.json` — 22 frames of ASCII art (55 lines × \~120 cols each), using chars `x + - .` to draw a hammer-strikes-anvil animation. The anvil body (lines \~23–41) is static across all frames; the hammer/arm/sparks (lines \~0–22) change per frame.
- `src-tauri/src/logos` — scratch file with logo design concepts (includes the mort face). Not user-facing but should be cleaned up.
- `scripts/distribute.sh` — uploads `install.sh` to R2 at `distribute/install.sh`. Already clean (no logo in this file itself).

### Other mort logo references (non-user-facing)

- `plans/completed/remove-mort-migration.md` — historical docs, fine to leave
- `plans/completed/macos-code-signing-local.md` — references the old logo in docs context

## Phases

- [x] Create terminal animation data + renderer (`scripts/installation/anvil-animation.sh`)

- [x] Update `install.sh` to use the animation

- [x] Clean up `src-tauri/src/logos`

- [x] Verify distribute pipeline still works

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Create `scripts/installation/anvil-animation.sh`

This file gets uploaded to R2 alongside `install.sh` and contains:

### 1a. Scaled-down frame data

The landing page frames are 55×120 — too wide for most terminals. We need a **terminal-friendly version** (\~40 lines × \~80 cols). Two options:

- **Option A (preferred):** Write a build-time script (`scripts/installation/generate-frames.sh` or a Node script) that reads `frames.json` and downscales each frame to terminal size, outputting a compact format (e.g., base64-encoded gzipped text, or a heredoc array). This keeps the source of truth in `frames.json` and the terminal frames derived from it.
- **Option B (simpler):** Manually create a smaller set of terminal-sized frames (\~6-8 key frames instead of all 22) hand-tuned for terminal rendering. Store as a heredoc array in `anvil-animation.sh`.

**Recommendation:** Start with Option B — hand-pick \~6-8 key frames from the animation, scale them down manually to \~80 cols wide. The full 22-frame animation at 12fps is overkill for a 3-second download; 6-8 frames at \~4fps feels right for terminal.

### 1b. Animation renderer function

```bash
# anvil-animation.sh provides:
# - play_anvil_animation: starts animation in background, returns PID
# - stop_anvil_animation: stops animation, shows final anvil-only frame
# - ANVIL_LOGO: static anvil-only art for non-animated contexts
```

The renderer:

1. Hides cursor, clears screen area
2. Cycles through frames using `tput` for cursor positioning
3. Runs in a subshell/background process so [install.sh](http://install.sh) can continue downloading
4. On stop: clears animation area, prints the **anvil-only frame** (the bottom portion — lines 23-41 equivalent — showing just the anvil base without hammer/arm/sparks)

### 1c. The "anvil-only" final frame

Extract just the anvil body from the last frame of `frames.json` (approximately):

```
        -xxxxxxx+              xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
         xxxxxxxxxxxxxxxxxxxx  xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
          +xxxx   xxxxxxxxxxx .xxxx-  ..............                 .xxxxx
            xxxxx.            xxxxx                                  xxxxxx
              xxxxxxx.        xxxxx                       -xxxxxxxxxxxxxxxx
                .xxxxxxxxxxx. xxxxx                   +xxxxxxxxxxxxxxxxxxx+
                    +xxxxxxxx xxxxxxxx              xxxxxxxxxxx-
                          -x  xxxxxxxxxx-         xxxxxxxx.
                              .  .+xxxxxxx       xxxxxx-
                                    .xxxxx       xxxxx
                                     xxxxx       xxxxx
                                    xxxxxx       xxxxx
                                   xxxxxx         xxxxx.
                                .xxxxxx            +xxxxx+
                             -xxxxxxx      -+x+-     +xxxxxx+
                         xxxxxxxxx     xxxxxxxxxxxxx    xxxxxxxxx
                       xxxxxxx       xxxxxxx+++xxxxxx.      xxxxxxx
                      xxxxxxxxxxxxxxxxxx+         xxxxxxxxxxxxxxxxxx
                    .xxxxxxxxxxxxxxxxxxx           xxxxxxxxxxxxxxxxxx
```

This needs to be scaled/adjusted to fit \~80 cols.

## Phase 2: Update `install.sh`

Replace the mort logo heredoc (lines 1-9) with:

```bash
#!/bin/bash
set -e

# Download animation assets
ANIM_SCRIPT=$(mktemp)
curl -sfL https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev/distribute/anvil-animation.sh -o "$ANIM_SCRIPT" 2>/dev/null

if [ -f "$ANIM_SCRIPT" ] && [ -s "$ANIM_SCRIPT" ]; then
  source "$ANIM_SCRIPT"
  play_anvil_animation &
  ANIM_PID=$!
else
  # Fallback: static anvil logo if animation download fails
  cat << 'EOF'
    [static anvil ASCII art here]
EOF
fi

# ... existing download logic ...

# After download completes:
if [ -n "${ANIM_PID:-}" ]; then
  stop_anvil_animation "$ANIM_PID"
fi
rm -f "$ANIM_SCRIPT"
```

**Key design points:**

- Animation is **gracefully optional** — if the animation script can't be fetched, fall back to a simple static anvil logo
- [install.sh](http://install.sh) stays \~50 lines, clean and readable
- Animation runs in background during the actual app download (the slow part)

## Phase 3: Clean up `src-tauri/src/logos`

Remove the mort face designs from this file. Keep any anvil-specific logo concepts if they exist, or delete the file entirely if it's all mort-era scratch work.

## Phase 4: Update `distribute.sh`

Add upload of the new `anvil-animation.sh` to R2 alongside `install.sh`:

```bash
# In the "Upload Install Script" section:
npx wrangler r2 object put "anvil-builds/distribute/anvil-animation.sh" \
  --file="scripts/installation/anvil-animation.sh" \
  --content-type="text/plain" \
  --remote
```

## Open Questions

1. **Terminal width:** Should we detect terminal width and skip animation if &lt; 80 cols? Probably yes — fall back to static logo for narrow terminals.
2. **Frame count:** Is 6-8 hand-picked frames enough, or should we go for the full 22? Given the download is typically fast (&lt; 5 seconds), fewer frames feels right.
3. **Character set:** The landing page uses `x + - .` characters. Should the terminal version use the same, or switch to Unicode block characters (`█ ▓ ░ ▄ ▀`) for a richer look? The `x`-based style is distinctive and matches the brand — recommend keeping it.
4. **Should the anvil-only logo also replace the** `x` **chars with block chars?** E.g., a cleaner Unicode anvil shape for the final "done" display. Worth considering but not required for v1.

## Alternatives Considered

- **Embedding all frame data in [install.sh](http://install.sh):** Rejected — would make [install.sh](http://install.sh) 200+ lines of ASCII data, violating the "keep it clean" constraint.
- **Downloading frames.json directly:** Rejected — it's 140KB of JSON, wasteful for a terminal animation. Better to pre-process into a compact shell-native format.
- **No animation, just static logo:** This is the fallback if the animation approach proves too complex. A simple 10-line anvil ASCII art block in [install.sh](http://install.sh) would be clean and effective.