# TUI Bypass Permissions Setting & Auto-Accept

## Problem

Two issues with `--dangerously-skip-permissions` in TUI threads:

1. **No toggle** — the flag is hardcoded in `claude-tui-args-builder.ts`. Users can't turn it off.
2. **Annoying confirmation prompt** — Every time a TUI session spawns, Claude Code shows a fullscreen confirmation dialog requiring the user to arrow-down to "Yes, I accept" and press Enter. This is friction that adds no value in Mort's context since the user already opted in via settings.

## Design

### Setting: `tuiBypassPermissions`

Add a new boolean setting `tuiBypassPermissions` (default: `true` for backwards compat) to `WorkspaceSettings`. When false, the bypass flags are omitted from the CLI args.

Display this as a checkbox in `TerminalInterfaceSettings`, right below the existing "Use terminal interface" toggle.

### Skipping the confirmation prompt

Claude Code has two bypass-related flags:

- `--dangerously-skip-permissions` — activates bypass **and** shows an interactive confirmation prompt
- `--allow-dangerously-skip-permissions` — only *unlocks* bypass as an option (does NOT activate it)
- `--permission-mode bypassPermissions` — sets the permission mode

The SDK uses `--allow-dangerously-skip-permissions --permission-mode bypassPermissions` internally when `allowDangerouslySkipPermissions: true` + `permissionMode: 'bypassPermissions'` are set. This *may* skip the confirmation prompt since the "unlock" flag is the programmatic equivalent of user consent.

**⚠️ Needs manual verification**: Before implementing, run the following command and confirm it enters bypass mode without showing the confirmation dialog:

```bash
~/.local/bin/claude --allow-dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6
```

If the confirmation prompt still appears, fall back to the PTY auto-accept approach:

- Watch for `"Yes, I accept"` in terminal output after spawn
- Send `\x1B[B\r` (down-arrow + enter) to auto-dismiss
- Clean up listener after accept or 5s timeout

## Phases

- [ ] Phase 1: Add `tuiBypassPermissions` setting and UI toggle

- [ ] Phase 2: Make args builder conditional on the setting

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add `tuiBypassPermissions` setting and UI toggle

### `src/entities/settings/types.ts`

Add to `WorkspaceSettingsSchema`:

```typescript
/**
 * Whether TUI sessions launch with --dangerously-skip-permissions.
 * Optional — defaults to true for backwards compatibility.
 */
tuiBypassPermissions: z.boolean().optional(),
```

### `src/components/main-window/settings/terminal-interface-settings.tsx`

Add a second checkbox below the existing one:

```tsx
const bypassPermissions = useSettingsStore(
  (s) => s.workspace.tuiBypassPermissions ?? true,
);

// ... inside the SettingsSection, after the existing label:
<label className="flex items-center justify-between cursor-pointer">
  <div>
    <div className="text-sm text-surface-200">Bypass permissions</div>
    <div className="text-xs text-surface-500">
      Skip permission prompts in terminal sessions (--dangerously-skip-permissions)
    </div>
  </div>
  <input
    type="checkbox"
    checked={bypassPermissions}
    onChange={(e) => settingsService.set("tuiBypassPermissions", e.target.checked)}
    className="accent-accent-500"
  />
</label>
```

Only show this when `preferTerminalInterface` is true (or always show — either works, but gating it keeps the UI clean when TUI isn't in use).

---

## Phase 2: Make args builder conditional on the setting

### `src/lib/claude-tui-args-builder.ts`

Add `bypassPermissions` option to `buildSpawnConfig`:

```typescript
export function buildSpawnConfig(options: {
  sessionId?: string;
  model?: string;
  prompt?: string;
  bypassPermissions?: boolean;
}): ClaudeTuiSpawnConfig {
  const model = options.model ?? "claude-sonnet-4-6";
  const bypass = options.bypassPermissions ?? true;

  const args: string[] = [];

  if (bypass) {
    // Use the two-flag approach to skip the interactive confirmation prompt.
    // --allow-dangerously-skip-permissions makes bypass available,
    // --permission-mode bypassPermissions activates it.
    args.push("--allow-dangerously-skip-permissions", "--permission-mode", "bypassPermissions");
  }

  args.push("--model", model);
  // ... rest unchanged
```

### `src/lib/thread-creation-service.ts`

Pass the setting value when building spawn config:

```typescript
const bypassPermissions = useSettingsStore.getState().workspace.tuiBypassPermissions ?? true;

const spawnConfig = buildSpawnConfig({
  prompt: options.prompt,
  bypassPermissions,
});
```

---

### Files changed

| File | Change |
| --- | --- |
| `src/entities/settings/types.ts` | Add `tuiBypassPermissions` field |
| `src/components/main-window/settings/terminal-interface-settings.tsx` | Add bypass permissions toggle |
| `src/lib/claude-tui-args-builder.ts` | Make `--dangerously-skip-permissions` conditional |
| `src/lib/thread-creation-service.ts` | Pass setting to args builder |
