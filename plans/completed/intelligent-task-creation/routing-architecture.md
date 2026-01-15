# Routing Architecture

## Hook + Skill Approach

Instead of a synchronous sub-agent (which adds latency), we use the Claude Agent SDK's **hooks** and **skills** for zero-overhead routing:

1. **`UserPromptSubmit` hook** - Injects current task state into every conversation
2. **`/route` skill** - Contains routing decision logic, invoked liberally (almost every request)

This eliminates the ~1-2s sub-agent overhead while maintaining intelligent task routing.

## Why This Works

The SDK supports **mid-run context injection** via hooks:
- Hooks can inject `systemMessage` content at any lifecycle point
- Skills load specialized instructions into the conversation
- The main agent makes routing decisions with full context (no sub-agent needed)

## Flow

```
User query → UserPromptSubmit hook fires
           → hook injects: current tasks, git state, workspace context
           → main agent starts with full task awareness
           → agent invokes /route skill (ALWAYS, unless trivial)
               → skill instructions guide: associate vs create vs subtask
               → agent executes CLI commands directly
               → agent manages git branch
           → agent continues with task context
```

## The `/route` Skill

**This skill runs on almost every request.** The only exceptions are truly trivial questions (greetings, one-liners).

The skill is NOT optional guidance—it's the primary workflow. The main agent's system prompt enforces this:

```
BEFORE doing ANY work, invoke the /route skill.
The ONLY exception: truly trivial questions (greetings, "what time is it").
If in doubt, route.
```

## Related

- [Route Skill Implementation](./implementation/route-skill.md)
- [Hooks Implementation](./implementation/hooks.md)
- [Main Agent Configuration](./implementation/main-agent.md)
