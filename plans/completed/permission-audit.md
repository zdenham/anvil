# Agent Permission Audit

## Summary

Audit of all SDK tools against each permission mode, identifying gaps and inconsistencies.

**SDK version:** 2.1.64 **Files:** `core/types/permissions.ts`, `agents/src/lib/permission-evaluator.ts`

## Evaluation Order

1. **Global overrides** (cannot be bypassed by any mode or custom override)
2. **Custom overrides** (from `PermissionConfig.overrides`)
3. **Mode rules** (first match wins)
4. **Mode default decision** (fallback)

---

## Global Overrides (all modes)

| Pattern | Condition | Decision | Reason |
| --- | --- | --- | --- |
| `^Bash$` | \`rm\\s+(-rf | \--force).\*.git\` | **deny** |
| \`^(Write | Edit)$\` | path matches `\.env` | **deny** |
| `^EnterWorktree$` | any | **deny** | Worktree creation managed by Anvil |

---

## Full Tool Matrix

All SDK tools (from `sdk-tools.d.ts`) mapped against each mode. Tools not matching any rule hit the mode's default.

| Tool | Plan | Implement | Approve | Notes |
| --- | --- | --- | --- | --- |
| **Read** | allow (rule 1) | allow (default) | allow (rule 1) |  |
| **Glob** | allow (rule 1) | allow (default) | allow (rule 1) |  |
| **Grep** | allow (rule 1) | allow (default) | allow (rule 1) |  |
| **WebFetch** | allow (rule 1) | allow (default) | allow (rule 1) |  |
| **WebSearch** | allow (rule 1) | allow (default) | allow (rule 1) |  |
| **TodoWrite** | allow (rule 1) | allow (default) | allow (rule 4) |  |
| **EnterPlanMode** | allow (rule 1) | allow (default) | allow (rule 4) |  |
| **AskUserQuestion** | allow (rule 1) | allow (default) | allow (rule 4) | Also bypassed in hook (separate gate) |
| **Skill** | allow (rule 1) | allow (default) | allow (rule 4) |  |
| **Bash** | allow (rule 2) | allow (default) | allow (rule 2) | Subject to global `rm -rf .git` override |
| **Agent** | allow (rule 3) | allow (default) | allow (rule 3) | Formerly `Task` |
| **Task** | allow (rule 3) | allow (default) | allow (rule 3) | Legacy name, SDK &lt;0.2.64 |
| **Write** | plans/ only (rule 4), else deny (rule 5) | allow (default) | **ask** (rule 5) | Subject to global `.env` override |
| **Edit** | plans/ only (rule 4), else deny (rule 5) | allow (default) | **ask** (rule 5) | Subject to global `.env` override |
| **NotebookEdit** | plans/ only (rule 4), else deny (rule 5) | allow (default) | **ask** (rule 5) |  |
| **ExitPlanMode** | **deny** (rule 6) | allow (default) | allow (rule 4) | Intentionally blocked in plan mode |
| **SendMessage** | **deny** (default) | allow (default) | allow (rule 4) | **GAP in plan mode** |
| **TeamCreate** | **deny** (default) | allow (default) | allow (rule 4) | **GAP in plan mode** |
| **TeamDelete** | **deny** (default) | allow (default) | allow (rule 4) | **GAP in plan mode** |
| **TaskOutput** | **deny** (default) | allow (default) | allow (rule 4) | **GAP in plan mode** |
| **TaskStop** | **deny** (default) | allow (default) | allow (rule 4) | **GAP in plan mode** |
| **EnterWorktree** | deny (global) | deny (global) | deny (global) | Global override, all modes |
| **Config** | **deny** (default) | allow (default) | **ask** (default) | Not in any mode's rules |
| **Mcp** | deny (global) | deny (global) | deny (global) | Globally denied — MCP not supported |
| **ListMcpResources** | deny (global) | deny (global) | deny (global) | Globally denied — MCP not supported |
| **ReadMcpResource** | deny (global) | deny (global) | deny (global) | Globally denied — MCP not supported |
| **SubscribeMcpResource** | deny (global) | deny (global) | deny (global) | Globally denied — MCP not supported |
| **UnsubscribeMcpResource** | deny (global) | deny (global) | deny (global) | Globally denied — MCP not supported |
| **SubscribePolling** | deny (global) | deny (global) | deny (global) | Globally denied — MCP not supported |
| **UnsubscribePolling** | deny (global) | deny (global) | deny (global) | Globally denied — MCP not supported |

---

## Issues Found

### 1. Plan mode denies team coordination tools

`SendMessage`, `TeamCreate`, `TeamDelete`, `TaskOutput`, `TaskStop` all fall through to `defaultDecision: "deny"` in plan mode. This is inconsistent — `Agent` is allowed (rule 3) but the agent can't coordinate with teams or check on background tasks.

**Impact:** Agents in plan mode can spawn sub-agents but cannot use team workflows or monitor background tasks.

**Fix:** Add team/task tools to plan mode's allow list:

```ts
// After rule 3 (Agent):
{ toolPattern: "^(SendMessage|TeamCreate|TeamDelete|TaskOutput|TaskStop)$", decision: "allow" },
```

### ~~2. MCP tools not explicitly handled~~ — Resolved

All MCP and polling tools are now globally denied. MCP is not supported.

### 3. `Config` tool falls through everywhere

The `Config` tool (SDK internal) is not in any mode's explicit rules. In plan mode it's denied, in approve mode it gets "ask". It's unclear whether this tool is user-facing or internal.

**Recommendation:** Investigate what `Config` does in the SDK. If it's benign metadata, add to allow lists. If it modifies settings, keep as-is.

### ~~4. Polling tools not handled~~ — Resolved

Polling tools are now globally denied alongside MCP tools.

### 5. `.env` override regex is broad

The global override pattern `\.env` matches any path containing `.env` anywhere (e.g., `src/environment.ts` would NOT match since it uses `pathPattern` on Write/Edit only, but `.env.example`, `.env.local`, `.env.production` all match). This is probably intentional but worth noting — agents cannot create `.env.example` template files.

---

## Phases

- [x] Audit all SDK tools against permission modes

- [x] Document gaps and inconsistencies

- [ ] Fix plan mode team tool gap

- [x] Decide on MCP tool policy

- [ ] Add missing tests for new tool coverage

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---