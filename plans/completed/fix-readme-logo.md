# Fix README Logo

## Problem

The README references `logo-rounded.png` which is still the old Mort face logo (pixelated smiley). The app has been rebranded to Anvil and the correct logo exists at `src-tauri/icons/icon.png` (anvil shape, white on dark background with rounded corners).

## Phases

- [x] Replace `logo-rounded.png` with the anvil logo
- [x] Clean up stale logo files at repo root

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Replace `logo-rounded.png`

The simplest approach: copy `src-tauri/icons/icon.png` to `logo-rounded.png` (overwrite the old Mort logo). The README already references this file at 128×128 display size, and the Tauri icon is 512×512 which will downscale fine.

No README text changes needed — the `<img>` tag and alt text ("Anvil") are already correct.

## Phase 2: Clean up stale logo files

These root-level files are all the old Mort branding and should be deleted:

- `icon-black.png` — Mort face, black on white (confirmed by visual inspection)
- `icon-white.png` — likely Mort face, white variant
- `icon-cropped-thicker.png` — likely Mort face variant
- `logo.png` — check if this is also Mort; delete if so
- `logo-rounded-padded.png` — check if this is also Mort; delete if so

Verify each file visually before deleting. Keep any that are actually the anvil logo or still referenced elsewhere.
