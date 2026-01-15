# Agent System Prompt Context

## Problem

The agent is not aware of its working directory, so it attempts operations in folders it doesn't have access to. The system prompt is entirely static and lacks crucial runtime context.

## Analysis

**Current state in `agents/src/runner.ts`:**
- `cwd` is passed to the Claude Agent SDK as an option (line 246)
- `systemPrompt` comes directly from static agent config (line 248)
- No dynamic context is injected into the system prompt

**What Claude Code includes (for reference):**
```
<env>
Working directory: /path/to/project
Is directory a git repo: Yes
Platform: darwin
OS Version: Darwin 23.5.0
Today's date: 2025-12-23
</env>

gitStatus: This is the git status at the start of the conversation.
Current branch: main
Status: ...
Recent commits: ...
```

## Missing Context

| Context | Why It Matters |
|---------|----------------|
| Working directory | Agent needs to know where it's operating |
| Git repo status | Whether git commands are available |
| Current branch | Avoid confusion about which branch to work on |
| Platform/OS | Commands differ between macOS/Linux/Windows |
| Today's date | For time-sensitive operations and documentation |
| Recent commits | Context about recent work |
| Task info | What task the agent is working on |

## Implementation

### 1. Create Context Builder

**`agents/src/context.ts`** (new file)

```typescript
import { execFileSync } from "child_process";

interface EnvironmentContext {
  workingDirectory: string;
  isGitRepo: boolean;
  platform: string;
  osVersion: string;
  date: string;
}

interface GitContext {
  currentBranch: string;
  status: string;
  recentCommits: string;
}

interface TaskContext {
  taskId: string;
  parentTaskId?: string;
}

export function buildEnvironmentContext(cwd: string): EnvironmentContext {
  const isGitRepo = checkIsGitRepo(cwd);

  return {
    workingDirectory: cwd,
    isGitRepo,
    platform: process.platform,
    osVersion: getOsVersion(),
    date: new Date().toISOString().split("T")[0],
  };
}

export function buildGitContext(cwd: string): GitContext | null {
  if (!checkIsGitRepo(cwd)) return null;

  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf-8",
    }).trim();

    const status = execFileSync("git", ["status", "--short"], {
      cwd,
      encoding: "utf-8",
    }).trim();

    const commits = execFileSync(
      "git",
      ["log", "--oneline", "-5"],
      { cwd, encoding: "utf-8" }
    ).trim();

    return {
      currentBranch: branch,
      status: status || "(clean)",
      recentCommits: commits,
    };
  } catch {
    return null;
  }
}

export function formatSystemPromptContext(
  env: EnvironmentContext,
  git: GitContext | null,
  task: TaskContext
): string {
  let context = `<env>
Working directory: ${env.workingDirectory}
Is directory a git repo: ${env.isGitRepo ? "Yes" : "No"}
Platform: ${env.platform}
Today's date: ${env.date}
Task ID: ${task.taskId}
</env>`;

  if (git) {
    context += `

<git>
Current branch: ${git.currentBranch}
Status:
${git.status}

Recent commits:
${git.recentCommits}
</git>`;
  }

  return context;
}

function checkIsGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd });
    return true;
  } catch {
    return false;
  }
}

function getOsVersion(): string {
  try {
    return execFileSync("uname", ["-rs"], { encoding: "utf-8" }).trim();
  } catch {
    return process.platform;
  }
}
```

### 2. Update Runner

**`agents/src/runner.ts`**

Modify the query call to inject context:

```typescript
import {
  buildEnvironmentContext,
  buildGitContext,
  formatSystemPromptContext,
} from "./context.js";

// In main(), before query():
const envContext = buildEnvironmentContext(args.cwd);
const gitContext = buildGitContext(args.cwd);
const taskContext = { taskId: args.taskId, parentTaskId: args.parentTaskId };
const contextBlock = formatSystemPromptContext(envContext, gitContext, taskContext);

// Combine static system prompt with dynamic context
const fullSystemPrompt = `${agentConfig.systemPrompt}

${contextBlock}`;

// Update query call:
const result = query({
  prompt: args.prompt,
  options: {
    cwd: args.cwd,
    model: agentConfig.model ?? "claude-sonnet-4-20250514",
    systemPrompt: fullSystemPrompt,  // <-- Use combined prompt
    // ... rest unchanged
  },
});
```

### 3. Update Agent Config Type

**`agents/src/agent-types/index.ts`**

No changes needed - `systemPrompt` remains static in config, context is appended at runtime.

---

## Files to Modify

| File | Changes |
|------|---------|
| `agents/src/context.ts` | **NEW** - Context building utilities |
| `agents/src/runner.ts` | Import context builder, inject into system prompt |

---

## Future Enhancements

1. **Workspace context**: Include key files like `package.json`, `Cargo.toml` for project type detection
2. **Task description**: Pull task title/description from metadata for more context
3. **File tree snapshot**: Show top-level directory structure
4. **Dependencies**: List installed dependencies relevant to the task
