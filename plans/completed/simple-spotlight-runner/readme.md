# Simple Spotlight Runner - Sub-Plans

This folder contains the implementation broken into parallelizable sub-plans.

## Dependency Graph

```
01-types ─────────────────┬──────────────────────────────────┐
                          │                                  │
02-agent-runner ──────────┤                                  │
                          │                                  │
03-frontend-service ──────┼─────────────────────────────┐    │
                          │                             │    │
04-ui-components ─────────┤                             │    │
                          │                             │    │
05-tauri-commands ────────┤                             │    │
                          │                             │    │
06-entry-point-config ────┘                             │    │
                                                        │    │
07-spotlight-integration ───────────────────────────────┴────┘
```

## Execution Strategy

### Phase 1 (Parallel)
Run these 6 plans simultaneously - they have no dependencies on each other:

| Plan | Description | Est. Files |
|------|-------------|------------|
| `01-types` | Type definitions | 2 files modified |
| `02-agent-runner` | Agent runner in Node | 3 files created, 1 modified |
| `03-frontend-service` | Spawn/resume service | 2 files (1 new, 1 modified) |
| `04-ui-components` | React components | 4 files created |
| `05-tauri-commands` | Rust window commands | 2 files modified |
| `06-entry-point-config` | Entry point + build config | 4 files (2 new, 2 modified) |

### Phase 2 (Sequential)
Run after Phase 1 completes:

| Plan | Description | Dependencies |
|------|-------------|--------------|
| `07-spotlight-integration` | Wire it all together | All Phase 1 plans |

## Verification

After all plans complete, verify:

1. `pnpm build` succeeds
2. `pnpm typecheck` passes
3. Enter in Spotlight creates simple task
4. Cmd+Enter in Spotlight creates full task
5. Simple task window opens and streams messages
