# 06 - UI Integration (Spotlight)

**Tier:** 4
**Depends on:** 05-agent-service, 00a-task-entity
**Parallelizable with:** 07-maintenance

---

## Contracts

### Exports (Other Plans Depend On)

None - this is a leaf plan (end consumer).

### Imports (This Plan Depends On)

```typescript
// From 05-agent-service
import {
  getAgentService,
  type AgentService,
  type StartAgentOptions,
} from "@/lib/agent-service";

// From 00a-task-entity
import {
  createTaskService,
  generateTaskId,
  type Task,
  type TaskService,
} from "@/entities/tasks/task-service";
```

---

## Implementation

### File: `src/components/spotlight/spotlight.tsx`

#### Current Code (Lines ~129-130)

```typescript
// BEFORE: Direct worktree access without coordination
const repo = repos[0];
const latestVersion = repoService.getLatestVersion(repo.name);
const workingDirectory = latestVersion.path;

// Then later...
await startAgent({
  agentType: selectedAgent,
  cwd: workingDirectory,
  prompt: promptText,
  conversationId: newConversation.id,
});
```

#### Updated Code

```typescript
// AFTER: Use agent service with workspace management
import { getAgentService } from "@/lib/agent-service";
import { createTaskService } from "@/entities/tasks/task-service";

// Services (initialize once)
const agentService = getAgentService();
const taskService = createTaskService();

// In component or hook - ensure agent service is initialized
useEffect(() => {
  agentService.initialize();
  return () => agentService.dispose();
}, []);

// When starting a task
async function handleStartTask(
  promptText: string,
  selectedAgent: string,
  selectedRepo: Repository  // Now explicitly passed, not assumed
) {
  // Create task using task service (from 00a-task-entity)
  const task = await taskService.createTask({
    title: promptText.slice(0, 100),
    repositoryName: selectedRepo.name,
    parentTaskId: currentTask?.id,  // For subtasks
  });

  // Start agent - workspace allocation happens internally
  const { conversationId, workingDirectory } = await agentService.startAgent({
    agentType: selectedAgent,
    repoName: selectedRepo.name,
    prompt: promptText,
    taskId: task.id,
    parentTaskId: task.parentTaskId,
  });

  // Update UI with conversation
  setCurrentConversation({
    id: conversationId,
    taskId: task.id,
    workingDirectory,
    // ...
  });
}
```

---

## Task Creation Flow

The spotlight uses the TaskService from [00a-task-entity](./00a-task-entity.md) to create tasks:

```typescript
import { createTaskService, type CreateTaskOptions } from "@/entities/tasks/task-service";

const taskService = createTaskService();

// Task is created before starting the agent
const task = await taskService.createTask({
  title: promptText.slice(0, 100),  // Truncate for display
  repositoryName: selectedRepo.name,
  parentTaskId: parentTask?.id,     // For subtasks
});

// Task ID is then passed to the agent service
await agentService.startAgent({
  taskId: task.id,
  // ...
});
```

The TaskService handles:
- Generating unique task IDs via `generateTaskId()`
- Persisting task metadata to `~/.anvil/tasks/`
- Setting initial status to `"pending"`

---

## Subtask Support

When creating a subtask from an existing task:

```typescript
import { createTaskService } from "@/entities/tasks/task-service";
import { getAgentService } from "@/lib/agent-service";

const taskService = createTaskService();
const agentService = getAgentService();

// In task detail view or context menu
async function handleCreateSubtask(parentTask: Task, prompt: string) {
  // Create subtask using task service (generates ID internally)
  const subtask = await taskService.createTask({
    title: prompt.slice(0, 100),
    repositoryName: parentTask.repositoryName,
    parentTaskId: parentTask.id,  // Links to parent
  });

  // Start agent with subtask
  const { conversationId, workingDirectory } = await agentService.startAgent({
    agentType: "coder",
    repoName: parentTask.repositoryName,
    prompt: prompt,
    taskId: subtask.id,
    parentTaskId: parentTask.id,
  });

  // The workspace service will:
  // 1. Create branch from parent's branch (not main)
  // 2. Store parent task ID in branch info
  // 3. Use parent's current commit as merge base
}
```

---

## State Management Updates

Update relevant stores/state to track workspace info:

```typescript
// In conversation store or state
interface ConversationState {
  id: string;
  taskId: string;
  workingDirectory: string;  // Now comes from allocation
  status: "running" | "completed" | "error";
}

// When conversation ends
async function handleConversationEnd(conversationId: string) {
  await agentService.stopAgent(conversationId);

  // Update UI state
  updateConversation(conversationId, { status: "completed" });
}
```

---

## Repository Selection

The UI must handle multi-repo scenarios instead of assuming `repos[0]`:

```typescript
// Option 1: Repository selector in spotlight
function SpotlightDialog() {
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const repos = useRepositories();

  // Auto-select if only one repo
  useEffect(() => {
    if (repos.length === 1 && !selectedRepo) {
      setSelectedRepo(repos[0]);
    }
  }, [repos]);

  return (
    <Dialog>
      {repos.length > 1 && (
        <RepositorySelector
          repos={repos}
          selected={selectedRepo}
          onSelect={setSelectedRepo}
        />
      )}
      <PromptInput
        disabled={!selectedRepo}
        onSubmit={(prompt) => handleStartTask(prompt, agentType, selectedRepo!)}
      />
    </Dialog>
  );
}

// Option 2: Infer from current context
function useSelectedRepository(): Repository | null {
  const repos = useRepositories();
  const currentTask = useCurrentTask();

  // If in a task context, use that task's repo
  if (currentTask) {
    return repos.find(r => r.name === currentTask.repositoryName) ?? null;
  }

  // If only one repo, use it
  if (repos.length === 1) {
    return repos[0];
  }

  // Multiple repos, need explicit selection
  return null;
}
```

---

## UI Changes Summary

| Component | Change |
|-----------|--------|
| `spotlight.tsx` | Use agentService.startAgent instead of direct worktree access |
| Repository selection | Explicit repo selection for multi-repo setups |
| Task creation | Create task entity before starting agent via TaskService |
| Subtask UI | Pass parentTaskId when creating subtasks |
| Conversation end | Call agentService.stopAgent to release workspace |
| App startup | Call agentService.initialize() |
| App shutdown | Call agentService.dispose() |

---

## Error Handling in UI

```typescript
async function handleStartTask(promptText: string) {
  try {
    setLoading(true);

    const { conversationId, workingDirectory } = await agentService.startAgent({
      agentType: selectedAgent,
      repoName: repo.name,
      prompt: promptText,
      taskId: task.id,
    });

    // Success - update UI

  } catch (error) {
    if (error.message.includes("No available worktrees")) {
      showNotification({
        type: "warning",
        message: "All worktrees are in use. Please wait for a task to complete.",
      });
    } else {
      showNotification({
        type: "error",
        message: `Failed to start task: ${error.message}`,
      });
    }
  } finally {
    setLoading(false);
  }
}
```

---

## Migration Notes

For existing conversations without task associations:
- They can continue in read-only mode
- New conversations require task/workspace management
- Consider adding migration UI for orphaned conversations

---

## Verification

- [ ] Spotlight uses agentService instead of direct worktree access
- [ ] Task is created via TaskService before starting agent
- [ ] Subtasks can be created from parent tasks
- [ ] Workspace is released when conversation ends
- [ ] Error states are handled gracefully in UI
- [ ] Multi-repo scenarios handled (repo selector or context inference)
- [ ] Agent service initialized on app startup
- [ ] Agent service disposed on app shutdown
