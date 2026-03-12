# Simplify `mort.spawn()` API

## Problem

`mort.spawn()` previously accepted 4 options (`prompt`, `agentType`, `cwd`, `permissionMode`). Three were dead weight:

- `agentType` — only one agent config exists, runner ignores it
- `permissionMode` — always inherited from parent, hub propagation handles changes
- `cwd` — always uses parent's working directory

## Result

```typescript
// Before
const result = await mort.spawn({
  prompt: "Fix the failing auth tests",
  agentType: "general-purpose",
  cwd: "/path/to/dir",
  permissionMode: "bypassPermissions",
});

// After
const result = await mort.spawn({ prompt: "Fix the failing auth tests" });
```

## Phases

- [x] Remove `agentType`, `permissionMode`, and `cwd` from `SpawnOptions` type and `child-spawner.ts`

- [x] Keep object argument with single `prompt` key (extensible for future options)

- [x] Update SKILL.md documentation

- [x] Update tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---