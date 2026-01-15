# Challenges & Mitigations

## 1. Ensuring Skill Runs Liberally

**Challenge**: The agent might skip routing and jump straight to work.

**Mitigation**: Double reinforcement:
- System prompt: "BEFORE doing ANY work, invoke /route skill."
- Hook injection: "Remember: Invoke /route skill before doing any work."

## 2. Skill Compliance

**Challenge**: If the agent skips routing, it might miss task context.

**Mitigation**: The hook's injected context still shows task state—the agent has the information even if it doesn't formally route. But the skill ensures consistent decision-making.

## 3. Slug Conflicts

**Challenge**: Multiple tasks could generate the same slug.

**Mitigation**: CLI handles automatically with `kebab-name-[n]` pattern. Both task slug and branch name must be unique.

## 4. Dirty Working Directory

**Challenge**: Branch switching with uncommitted changes.

**Options**:
- Block switch and notify user to commit/stash
- Auto-stash and restore after switch
- Carry changes to new branch (git checkout allows this if no conflicts)

**Recommendation**: Warn user and let them decide. Don't auto-stash without consent.

## 5. Branch Recreation

**Challenge**: Task exists but branch was deleted.

**Mitigation**: Recreate from main with warning. The task metadata is the source of truth, not the branch.

## 6. Over-Creation of Tasks

**Challenge**: Agent creates too many new tasks instead of associating.

**Mitigation**:
- Skill emphasizes "check existing tasks first"
- Skill says "default to association when there's semantic overlap"
- Hook pre-injects active/recent tasks so the agent sees them immediately

## 7. Zero Latency Overhead

**Challenge**: Sub-agent approach adds ~1-2s latency per request.

**Mitigation**: Hooks fire synchronously with near-zero overhead. The skill is just prompt injection, not a separate agent call. This approach eliminates the latency entirely.
