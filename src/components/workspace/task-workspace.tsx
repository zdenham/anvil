import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { TaskHeader } from "./task-header";
import { LeftMenu, type WorkspaceTab } from "./left-menu";
import { MainContentPane } from "./main-content-pane";
import { ActionPanel } from "./action-panel";
import { ChatPane } from "./chat-pane";
import { useTaskStore } from "@/entities/tasks/store";
import { useTaskThreads } from "@/hooks/use-task-threads";
import { useFileContents } from "@/hooks/use-file-contents";
import { useThreadStore } from "@/entities/threads/store";
import {
  spawnAgentWithOrchestration,
  resumeAgent,
  buildMergeContextForTask,
} from "@/lib/agent-service";
import { eventBus } from "@/entities/events";
import { threadService } from "@/entities/threads/service";
import { logger } from "@/lib/logger-client";
import { useMarkThreadAsRead } from "@/hooks/use-mark-thread-as-read";
import type { FileChange, ToolExecutionState } from "@/lib/types/agent-messages";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { WorkflowMode } from "@/entities/settings/types";

// Stable empty references to avoid re-renders from ?? creating new objects
const EMPTY_MESSAGES: MessageParam[] = [];
const EMPTY_FILE_CHANGES = new Map<string, FileChange>();
const EMPTY_TOOL_STATES: Record<string, ToolExecutionState> = {};

// Local interface to mirror the MergeContext from agents package
interface MergeContext {
  taskBranch: string;
  baseBranch: string;
  taskWorktreePath: string;
  mainWorktreePath: string;
  workflowMode: WorkflowMode;
}

/**
 * Build a dynamic system prompt for the merge agent.
 * This is a local implementation since the agents package isn't easily importable in the frontend.
 * It mirrors the structure of buildMergeAgentPrompt from agents/src/agent-types/merge.ts
 */
function buildMergeAgentSystemPrompt(context: MergeContext): string {
  const { workflowMode } = context;

  // Build environment section
  const environmentSection = `## Environment

- **Task Worktree:** \`${context.taskWorktreePath}\`
  - Branch: \`${context.taskBranch}\`
- **Main Worktree:** \`${context.mainWorktreePath}\`
  - Branch: \`${context.baseBranch}\`

You are currently in the task worktree. Use \`git -C ${context.mainWorktreePath}\` for operations on the main worktree.`;

  // Build strategy-specific instructions based on workflow mode
  const strategyInstructions = workflowMode === "solo"
    ? buildSoloDevInstructions(context)
    : buildTeamInstructions(context);

  // Compose full prompt (mirrors the structure in merge.ts)
  return `## Role

You are the merge agent for Mort. You integrate completed work into the target branch using the configured merge strategy.

${environmentSection}

${strategyInstructions}

## Conflict Resolution

When you encounter merge/rebase conflicts, analyze and resolve them intelligently.

### Analysis Steps

For each conflicting file:

1. **Read the conflict markers** to understand both versions:
   \`\`\`bash
   cat <file>  # Shows <<<<<<< HEAD ... ======= ... >>>>>>> markers
   \`\`\`

2. **Understand the intent** of each side:
   \`\`\`bash
   git log --oneline -5 -- <file>  # Recent changes to this file
   git show HEAD:<file>            # Our version
   git show REBASE_HEAD:<file>     # Their version (during rebase)
   \`\`\`

### Resolve Autonomously When:

- **Non-overlapping changes:** Both sides modified different parts of the file
- **Additive changes:** One side added imports, the other added functions
- **Complementary changes:** Both changes can coexist (e.g., different config keys)
- **Superset changes:** One version includes all changes from the other plus more
- **Formatting/whitespace:** Trivial differences that don't affect logic

### Request Human Review When:

- **Semantic conflicts:** Both sides changed the same business logic differently
- **API changes:** Function signatures or interfaces were modified incompatibly
- **Complex merges:** More than 5 files with non-trivial conflicts
- **Uncertain intent:** You cannot determine which version is correct
- **Test conflicts:** Test files where correctness depends on implementation choice

### Resolution Process

1. **Edit the file** to resolve conflicts (remove markers, merge code)
2. **Stage the resolution:**
   \`\`\`bash
   git add <file>
   \`\`\`
3. **Continue the rebase/merge:**
   \`\`\`bash
   git rebase --continue  # For rebase
   git commit             # For merge (if needed)
   \`\`\`

### Abort and Escalate

If resolution becomes too complex:

\`\`\`bash
git rebase --abort  # or git merge --abort
\`\`\`

Then request human review with:
- List of conflicting files
- Summary of what each side changed
- Why autonomous resolution isn't feasible

## Safety Guidelines

- Use \`git\` and \`gh\` CLI commands directly
- Verify you're in the correct repository before making changes
- Do NOT force push or use destructive operations without user confirmation
- Check \`git status\` before and after operations
- If anything goes wrong, report and request human review

## Guidelines

- Be concise in reporting results
- Always verify the working directory is clean before merging
- Report success with commit hash or PR URL
- **Request human review** when:
  - Merge conflicts occur
  - Any git operation fails
  - The merge is complete and needs user confirmation`;
}

function buildSoloDevInstructions(context: MergeContext): string {
  const { taskBranch, baseBranch, mainWorktreePath } = context;

  return `## Solo Dev Workflow

This workflow rebases onto your LOCAL main branch, then fast-forward merges. No remote operations on main.

### Happy Path

1. **Check main worktree for uncommitted changes:**
   \`\`\`bash
   git -C ${mainWorktreePath} status --porcelain
   \`\`\`
   - If output is NOT empty: **Request human review** ("main has uncommitted changes")

2. **Check if main is behind origin (fetch refs only):**
   \`\`\`bash
   git -C ${mainWorktreePath} fetch origin ${baseBranch}
   BEHIND=$(git -C ${mainWorktreePath} rev-list --count ${baseBranch}..origin/${baseBranch})
   echo "Main is $BEHIND commits behind origin"
   \`\`\`
   - If BEHIND > 0: **Request human review** ("main is behind origin, please pull")
   - Note: Main being AHEAD of origin is allowed (solo devs may have unpushed commits)

3. **Rebase task branch onto LOCAL main:**
   \`\`\`bash
   # Get the commit SHA of local main from the main worktree
   MAIN_SHA=$(git -C ${mainWorktreePath} rev-parse ${baseBranch})
   git rebase $MAIN_SHA
   \`\`\`
   - If conflicts occur, see **Conflict Resolution** section
   - For complex conflicts (>5 files or semantic): abort and request human review

4. **Fast-forward merge in main worktree:**
   \`\`\`bash
   # Task branch is visible since worktrees share the same git repo
   git -C ${mainWorktreePath} merge --ff-only ${taskBranch}
   \`\`\`
   - If --ff-only fails: **Request human review** (rebase may not have completed correctly)

5. **Report success:**
   \`\`\`bash
   git -C ${mainWorktreePath} log -1 --format="%H %s"
   \`\`\`
   - Report the commit hash and request human review to confirm

### Unhappy Paths

| Scenario | Action |
|----------|--------|
| Main has uncommitted changes | Request human review |
| Main is behind origin | Request human review ("please pull") |
| Simple rebase conflicts (<5 files) | Auto-resolve per Conflict Resolution |
| Complex rebase conflicts | \`git rebase --abort\`, request human review |
| --ff-only merge fails | Request human review |`;
}

function buildTeamInstructions(context: MergeContext): string {
  const { taskBranch, baseBranch } = context;

  return `## Team Workflow

This workflow rebases onto origin/main and creates a pull request for code review.

### Happy Path

1. **Verify clean state in task worktree:**
   \`\`\`bash
   git status  # Must show "nothing to commit, working tree clean"
   \`\`\`

2. **Fetch and rebase onto origin/main:**
   \`\`\`bash
   git fetch origin ${baseBranch}
   git rebase origin/${baseBranch}
   \`\`\`
   - If conflicts occur, see **Conflict Resolution** section

3. **Push rebased branch:**
   \`\`\`bash
   git push origin ${taskBranch} --force-with-lease
   \`\`\`

4. **Create or find PR:**
   \`\`\`bash
   # Check for existing PR
   EXISTING_PR=$(gh pr list --head ${taskBranch} --json url --jq '.[0].url')

   if [ -n "$EXISTING_PR" ]; then
     echo "Existing PR: $EXISTING_PR"
   else
     # Create new PR
     gh pr create --base ${baseBranch} --head ${taskBranch} \\
       --title "Merge ${taskBranch}" \\
       --body "Automated merge from Mort task completion."
   fi
   \`\`\`

5. **Store and report PR URL:**
   \`\`\`bash
   mort tasks update --id $TASK_ID --pr-url <PR_URL> --json
   \`\`\`
   - Report the PR URL and request human review

### Unhappy Paths

| Scenario | Action |
|----------|--------|
| Uncommitted changes in task worktree | Commit or stash first |
| Simple rebase conflicts (<5 files) | Auto-resolve per Conflict Resolution |
| Complex rebase conflicts | \`git rebase --abort\`, request human review |
| Push fails | Request human review |
| PR creation fails | Request human review |`;
}

const DEFAULT_CHAT_WIDTH = 400;
const MIN_CHAT_WIDTH = 250;
const MAX_CHAT_WIDTH = 800;

/**
 * Build contextual prompt for the next agent based on phase transition.
 * For merge agent, returns null - use buildMergeContextForTask instead.
 */
function buildProgressionPrompt(
  agentType: string,
  task: { title: string },
  approvalMessage: string
): string | null {
  switch (agentType) {
    case "execution":
      return `Task: ${task.title}
Approval: ${approvalMessage}

Begin implementation.`;

    case "review":
      return `Implementation is complete. Please review the changes on the task branch.

Task: ${task.title}
Completion note: ${approvalMessage}

Review the git diff against the main branch and evaluate against the plan in content.md.`;

    case "merge":
      // Merge prompt is built asynchronously with branch/settings info
      return null;

    default:
      return approvalMessage || `Continue work on: ${task.title}`;
  }
}

interface TaskWorkspaceProps {
  taskId: string;
  initialThreadId?: string;
}

/**
 * Main task workspace component.
 * Combines left menu navigation, main content pane, and action panel.
 *
 * Layout:
 * - TaskHeader: Full-width header with task info
 * - LeftMenu: Always-visible navigation with tabs and thread list
 * - MainContentPane: Shows content based on selected tab
 * - ActionPanel: Fixed bottom with context-aware actions
 */
export function TaskWorkspace({ taskId, initialThreadId }: TaskWorkspaceProps) {
  const windowLabel =
    typeof window !== "undefined"
      ? (window as any).__TAURI__?.webviewWindow?.label ?? "unknown"
      : "ssr";
  logger.log(`[TaskWorkspace:${windowLabel}] ====== RENDER ======`, {
    taskId,
    initialThreadId,
  });

  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    initialThreadId ?? null
  );

  // Resizable chat pane state
  const [chatWidth, setChatWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_CHAT_WIDTH;
    const stored = localStorage.getItem("chatPaneWidth");
    return stored
      ? Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, parseInt(stored, 10)))
      : DEFAULT_CHAT_WIDTH;
  });
  const chatWidthRef = useRef(chatWidth);
  const isResizing = useRef(false);

  const task = useTaskStore((state) => state.tasks[taskId]);
  const allTasks = useTaskStore((state) => state.tasks);
  const threads = useTaskThreads(taskId);

  logger.log(`[TaskWorkspace:${windowLabel}] Store state:`, {
    taskId,
    taskFound: !!task,
    taskKeys: Object.keys(allTasks),
    threadsCount: threads.length,
  });

  // Get the active thread (selected or first available)
  const activeThreadId = selectedThreadId ?? threads[0]?.id ?? null;

  // Disk-first: Thread state from consolidated store, derived from activeThreadId
  const activeState = useThreadStore((s) =>
    s.activeThreadId ? s.threadStates[s.activeThreadId] : undefined
  );
  const activeMetadata = useThreadStore((s) =>
    s.activeThreadId ? s.threads[s.activeThreadId] : undefined
  );
  const isLoading = useThreadStore((s) => s.activeThreadLoading);
  const loadError = useThreadStore((s) =>
    s.activeThreadId ? s.threadErrors[s.activeThreadId] : undefined
  );

  // Handle marking thread as read when viewed or completed
  useMarkThreadAsRead(activeThreadId, {
    markOnView: true,
    markOnComplete: true, // Re-enabled with task panel check to prevent Spotlight interference
    requiredPanel: "task", // Only mark as read when task panel is visible
  });

  // Set active thread in store and load state when it changes
  useEffect(() => {
    logger.log(`[TaskWorkspace:${windowLabel}] Setting active thread:`, activeThreadId);
    threadService.setActiveThread(activeThreadId);
  }, [activeThreadId, windowLabel]);

  // Messages - direct from state
  const messages = activeState?.messages ?? EMPTY_MESSAGES;

  // FileChanges - convert from array (disk format) to Map (UI format)
  const fileChanges = useMemo(() => {
    if (!activeState?.fileChanges?.length) return EMPTY_FILE_CHANGES;
    const map = new Map<string, FileChange>();
    for (const change of activeState.fileChanges) {
      map.set(change.path, change);
    }
    return map;
  }, [activeState?.fileChanges]);

  // Tool states - direct from state
  const toolStates = activeState?.toolStates ?? EMPTY_TOOL_STATES;

  // Status - map "complete" (agent format) to "completed" (UI format)
  const status = activeState?.status === "complete" ? "completed" : activeState?.status ?? "idle";

  // Working directory - from metadata (not state)
  const workingDirectory = activeMetadata?.workingDirectory ?? "";

  const isStreaming = status === "running";

  // Debug: Log state source and message count
  logger.log(`[TaskWorkspace:${windowLabel}] STATE SOURCE:`, {
    activeThreadId,
    storeActiveThreadId: useThreadStore.getState().activeThreadId,
    msgCount: messages.length,
    status,
    isStreaming,
    isLoading,
  });

  // Compute view status for ChatPane
  const viewStatus = isLoading
    ? "loading"
    : loadError
    ? "error"
    : isStreaming
    ? "running"
    : status === "completed"
    ? "completed"
    : "idle";

  // Load file contents for diff viewer
  const { contents: fullFileContents, loading: filesLoading } = useFileContents(
    fileChanges,
    workingDirectory
  );

  // Auto-select first thread when available
  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, selectedThreadId]);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = chatWidthRef.current;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      // Moving left increases chat width (since chat is on the right)
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(
        MIN_CHAT_WIDTH,
        Math.min(MAX_CHAT_WIDTH, startWidth + delta)
      );
      chatWidthRef.current = newWidth;
      setChatWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      localStorage.setItem("chatPaneWidth", String(chatWidthRef.current));
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  /**
   * Spawn a new agent of the specified type for progression.
   * Creates a NEW thread (not resuming the old one).
   */
  const handleProgressToNextStep = useCallback(
    async (nextAgentType: string, defaultMessage: string) => {
      logger.info("[TaskWorkspace] handleProgressToNextStep called", {
        nextAgentType,
        defaultMessage,
        hasTask: !!task,
        taskId,
        taskTitle: task?.title,
        taskStatus: task?.status,
        threadCount: threads.length,
        workingDirectory,
      });

      if (!task) {
        logger.warn(
          "[TaskWorkspace] handleProgressToNextStep: No task to progress - early return"
        );
        return;
      }

      try {
        // Build prompt - merge agent needs special handling with context
        let prompt: string;
        let appendedPromptOverride: string | undefined;

        if (nextAgentType === "merge") {
          logger.info("[TaskWorkspace] Building merge context", {
            taskId: task.id,
            repositoryName: task.repositoryName,
          });
          const mergeContext = await buildMergeContextForTask(task);
          if (!mergeContext) {
            logger.error(
              "[TaskWorkspace] Failed to build merge context - check preceding [agent] warnings for specific cause",
              { taskId: task.id, repositoryName: task.repositoryName }
            );
            return;
          }
          // Simple user prompt - the dynamic system prompt provides the full workflow
          prompt = `Please merge this branch with the appropriat merge strategy.`;

          // Build dynamic system prompt with full merge workflow instructions
          appendedPromptOverride = buildMergeAgentSystemPrompt(mergeContext);
          logger.info("[TaskWorkspace] Built merge agent system prompt", {
            workflowMode: mergeContext.workflowMode,
            promptLength: appendedPromptOverride.length,
          });
        } else {
          const basicPrompt = buildProgressionPrompt(
            nextAgentType,
            task,
            defaultMessage
          );
          if (!basicPrompt) {
            logger.error("[TaskWorkspace] Failed to build progression prompt");
            return;
          }
          prompt = basicPrompt;
        }

        logger.info("[TaskWorkspace] Built progression prompt", {
          nextAgentType,
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 200),
        });

        // Generate thread ID upfront for optimistic UI
        const threadId = crypto.randomUUID();

        // Create thread in store FIRST (before any async work or state updates)
        // This ensures the store has the thread for optimistic UI
        threadService.createOptimistic({
          id: threadId,
          taskId: task.id,
          status: "running",
        });

        logger.info("[TaskWorkspace] Calling spawnAgentWithOrchestration...", {
          agentType: nextAgentType,
          taskSlug: task.slug,
          threadId,
        });

        // Select the new thread immediately (optimistic UI)
        setSelectedThreadId(threadId);

        // Spawn agent with Node orchestration
        // Events (thread:created, agent:state, agent:completed) are handled by eventBus
        await spawnAgentWithOrchestration({
          agentType: nextAgentType,
          taskSlug: task.slug,
          taskId: task.id, // Required for event emissions
          threadId,
          prompt,
          appendedPromptOverride,
        });

        logger.info(
          `[TaskWorkspace] Spawned ${nextAgentType} agent successfully: ${threadId}`
        );
      } catch (err) {
        logger.error("[TaskWorkspace] Failed to spawn next agent:", err);
        logger.error("[TaskWorkspace] Error details:", {
          errorMessage: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? err.stack : undefined,
        });
      }
    },
    [task, taskId]
  );

  /**
   * Stay in current phase - resume existing agent with feedback.
   */
  const handleStayAndResume = useCallback(
    async (message: string) => {
      if (!activeThreadId) {
        // Can't resume - spawn new agent based on latest pending review's onFeedback or default to research
        if (task) {
          const latestReview = task.pendingReviews?.filter(r => !r.isAddressed).sort((a, b) => b.requestedAt - a.requestedAt)[0];
          const agentType = latestReview?.onFeedback ?? "research";
          await handleProgressToNextStep(agentType, message);
        }
        return;
      }

      try {
        await resumeAgent(activeThreadId, message, {
          onState: (state) => {
            eventBus.emit("agent:state", { threadId: activeThreadId, state });
          },
          onComplete: (exitCode, costUsd) => {
            eventBus.emit("agent:completed", {
              threadId: activeThreadId,
              exitCode,
              costUsd,
            });
          },
          onError: (error) => {
            eventBus.emit("agent:error", { threadId: activeThreadId, error });
          },
        });
      } catch (err) {
        logger.error("[TaskWorkspace] Failed to resume agent:", err);
      }
    },
    [activeThreadId, task, handleProgressToNextStep]
  );

  /**
   * Task is complete - no more agents to spawn.
   */
  const handleTaskComplete = useCallback(() => {
    logger.info(`[TaskWorkspace] Task ${taskId} completed`);
    // Could show a success message, close workspace, etc.
  }, [taskId]);

  const handleOpenTask = useCallback(() => {
    // Future: Navigate to task detail view
    logger.log("[TaskWorkspace] Open task:", taskId);
  }, [taskId]);

  const handleRetry = useCallback(() => {
    if (activeThreadId) {
      setSelectedThreadId(null);
      setTimeout(() => setSelectedThreadId(activeThreadId), 0);
    }
  }, [activeThreadId]);

  const handleThreadSelect = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
  }, []);

  if (!task) {
    logger.log(
      `[TaskWorkspace:${windowLabel}] ====== TASK NOT FOUND - SHOWING FALLBACK ======`,
      {
        taskId,
        availableTasks: Object.keys(allTasks),
      }
    );
    return (
      <div className="h-full w-full flex items-center justify-center bg-orange-900 text-white text-xl border-4 border-green-500">
        DEBUG: Task not found (taskId: {taskId}, available:{" "}
        {Object.keys(allTasks).join(", ") || "none"})
      </div>
    );
  }

  logger.log(`[TaskWorkspace:${windowLabel}] ====== RENDERING FULL UI ======`, {
    taskId,
    taskTitle: task.title,
    activeThreadId,
  });

  return (
    <div className="h-full flex flex-col bg-surface-900 relative">
      {/* Task header - spans full width */}
      <TaskHeader taskId={taskId} onOpenTask={handleOpenTask} />

      {/* Main layout: menu + content + chat */}
      <div className="flex-1 flex min-h-0">
        {/* Left Menu - always visible, fixed width */}
        <LeftMenu
          taskTitle={task.title}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          fileChangeCount={fileChanges.size}
          threads={threads}
          activeThreadId={activeThreadId}
          onThreadSelect={handleThreadSelect}
        />

        {/* Center: Main Content + Action Panel */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <MainContentPane
            tab={activeTab}
            taskId={taskId}
            fileChanges={fileChanges}
            fullFileContents={fullFileContents}
            workingDirectory={workingDirectory}
            filesLoading={filesLoading}
            branchName={task.branchName}
          />

          {/* Action panel below main content, not spanning chat */}
          <ActionPanel
            taskId={taskId}
            threadId={activeThreadId}
            onProgressToNextStep={handleProgressToNextStep}
            onStayAndResume={handleStayAndResume}
            onTaskComplete={handleTaskComplete}
          />
        </div>

        {/* Resize Handle */}
        <div
          className="w-1 bg-surface-700/50 hover:bg-surface-500/50 cursor-col-resize flex-shrink-0 transition-colors"
          onMouseDown={handleResizeStart}
        />

        {/* Right: Chat Pane */}
        <ChatPane
          threadId={activeThreadId}
          messages={messages}
          isStreaming={isStreaming}
          status={viewStatus}
          error={loadError}
          onRetry={handleRetry}
          width={chatWidth}
          toolStates={toolStates}
        />
      </div>
    </div>
  );
}
