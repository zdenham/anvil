---

## title: Fix --plugin flag → --plugin-dir for Claude TUI spawning

# Fix `--plugin` → `--plugin-dir` for Claude TUI spawning

## Problem

When opening a terminal thread, the Claude CLI errors with:

```
error: unknown option '--plugin'
```

The args builder at `src/lib/claude-tui-args-builder.ts:37` passes:

```
--plugin local:<anvilDir>
```

But the Claude CLI expects:

```
--plugin-dir <anvilDir>
```

The `--plugin local:` syntax was likely from an older CLI version or a different convention. The current CLI (`claude --help`) shows only `--plugin-dir <paths...>`.

## Root Cause

`buildSpawnConfig()` in `src/lib/claude-tui-args-builder.ts` constructs the wrong flag name and value format.

## Fix

Single-line change in `src/lib/claude-tui-args-builder.ts`:

```diff
- args.push("--plugin", `local:${options.anvilDir}`);
+ args.push("--plugin-dir", options.anvilDir);
```

Update the JSDoc comment on lines 15-16 accordingly:

```diff
- * Includes `--plugin local:<anvilDir>` to load the Anvil plugin
+ * Includes `--plugin-dir <anvilDir>` to load the Anvil plugin
```

## Files to Change

| File | Change |
| --- | --- |
| `src/lib/claude-tui-args-builder.ts` | `--plugin` → `--plugin-dir`, drop `local:` prefix |

## Verification

- Open a terminal thread in the app — should launch Claude TUI without error
- The Anvil plugin hooks should still fire (confirm via sidecar logs)

## Phases

- [x] Identify root cause

- [x] Update args builder flag and comment

- [ ] Manual verification

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---