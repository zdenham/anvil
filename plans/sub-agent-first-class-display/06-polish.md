# 06: Polish & Policy

Final polish: system prompt, cascaded archival, and testing.

## Phases

- [x] Add system prompt instruction for background agent policy
- [x] Implement cascaded archival (archive parent = archive children)
- [x] Performance testing with deep nesting
- [x] Integration testing

---

## System Prompt Addition

Add to `agents/src/agent-types/shared-prompts.ts`:

```markdown
## Sub-Agent Execution Policy

IMPORTANT: Do not use `run_in_background: true` when invoking the Task tool unless the user explicitly requests background execution.

For parallel work, launch multiple Task tools in a single message - these run concurrently while maintaining full streaming visibility for the user.

Background agents (`run_in_background: true`) should only be used when the user explicitly requests phrases like "run in background", "fire and forget", or "don't wait for it".
```

This is soft enforcement. Background agents will still work but are discouraged because:
- No real-time streaming (polling only)
- Parallel foreground agents provide the same concurrency benefit with full visibility

## Cascaded Archival

When archiving a parent thread, also archive all child sub-agent threads:

```typescript
async function archiveThread(threadId: string) {
  // Get all descendant threads
  const descendants = await getDescendantThreads(threadId);

  // Archive all (parent + descendants)
  for (const thread of [threadId, ...descendants]) {
    await markThreadArchived(thread);
  }
}

async function getDescendantThreads(threadId: string): Promise<string[]> {
  const children = threads.filter(t => t.parentThreadId === threadId);
  const descendants: string[] = [];

  for (const child of children) {
    descendants.push(child.id);
    descendants.push(...await getDescendantThreads(child.id));
  }

  return descendants;
}
```

## Testing Checklist

### Functional Tests
- [ ] Sub-agent thread created on SubagentStart
- [ ] Messages route correctly to child thread
- [ ] Sub-agent appears nested in tree
- [ ] Reference block shows in parent with flashing indicator
- [ ] Click reference block navigates to child
- [ ] Child thread is read-only (no input)
- [ ] Breadcrumb navigation works
- [ ] Parallel sub-agents display correctly
- [ ] Nested sub-agents display correctly

### Edge Cases
- [ ] Sub-agent with zero tool calls
- [ ] Very long sub-agent names (truncation)
- [ ] Navigate away while sub-agent running
- [ ] Sub-agent completes while viewing parent
- [ ] Deep nesting (3+ levels)

### Performance
- [ ] Many concurrent sub-agents (5+)
- [ ] Deep nesting performance
- [ ] Tree rendering with many sub-agents

## Files to Modify

- `agents/src/agent-types/shared-prompts.ts` - Background policy
- Thread archival logic (wherever archival is implemented)
