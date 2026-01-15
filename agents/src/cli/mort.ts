#!/usr/bin/env node
import { NodePersistence } from "../lib/persistence-node.js";
import type { TaskStatus, TaskMetadata } from "../core/types.js";
import { withCliTimeout } from "./timeout-wrapper.js";
import { TimeoutError } from "../lib/timeout.js";
import { logger } from "../lib/logger.js";
import { events } from "../lib/events.js";

// Always log invocation for debugging skill failures
logger.debug(`[mort-cli] Invoked with args: ${process.argv.slice(2).join(" ")}`);

// Parse --mort-dir early, before any commands are executed
// This is needed because persistence is used by all commands
function getMortDir(): string | undefined {
  const args = process.argv.slice(2);
  // Check for --mort-dir=value syntax
  const equalsSyntax = args.find(arg => arg.startsWith("--mort-dir="));
  if (equalsSyntax) {
    return equalsSyntax.slice("--mort-dir=".length);
  }
  // Check for --mort-dir value syntax
  const index = args.indexOf("--mort-dir");
  if (index !== -1 && index < args.length - 1) {
    return args[index + 1];
  }
  return undefined;
}

const mortDir = getMortDir();
if (mortDir) {
  logger.debug(`[mort-cli] Using mort-dir: ${mortDir}`);
}
const persistence = new NodePersistence(mortDir);

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

function getArg(args: string[], flag: string): string | undefined {
  // Check for --flag=value syntax
  const prefix = `${flag}=`;
  const equalsSyntax = args.find(arg => arg.startsWith(prefix));
  if (equalsSyntax) {
    return equalsSyntax.slice(prefix.length);
  }

  // Fall back to --flag value syntax
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  // Check for exact flag match
  if (args.includes(flag)) return true;
  // Check for --flag=value syntax (flag is present if value is provided)
  const prefix = `${flag}=`;
  return args.some(arg => arg.startsWith(prefix));
}

function outputJson(data: unknown): void {
  logger.info(JSON.stringify(data));
}

function error(message: string): never {
  logger.error(`[mort-cli] ERROR: ${message}`);
  logger.info(JSON.stringify({ error: message }));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation constants and functions
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATUSES = ["draft", "backlog", "todo", "in-progress", "in-review", "done", "cancelled"] as const;
const VALID_AGENT_TYPES = ["research", "execution", "review", "merge"] as const;

function validateStatus(value: string): TaskStatus {
  if (!VALID_STATUSES.includes(value as any)) {
    error(`Invalid status "${value}". Must be: ${VALID_STATUSES.join(", ")}`);
  }
  return value as TaskStatus;
}

type AgentType = typeof VALID_AGENT_TYPES[number];

function validateAgentType(value: string): AgentType {
  if (!VALID_AGENT_TYPES.includes(value as any)) {
    error(`Invalid agent type "${value}". Must be: ${VALID_AGENT_TYPES.join(", ")}`);
  }
  return value as AgentType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text output formatters
// ─────────────────────────────────────────────────────────────────────────────

function formatTaskLine(task: TaskMetadata): string {
  const parent = task.parentId ? task.parentId : "none";
  return `${task.slug} [${task.status}] "${task.title}"\n  id: ${task.id} | type: ${task.type} | parent: ${parent}`;
}

function formatTaskDetails(task: TaskMetadata): string {
  const parent = task.parentId ?? "none";
  const created = new Date(task.createdAt).toISOString().replace("T", " ").slice(0, 16);
  const updated = new Date(task.updatedAt).toISOString().replace("T", " ").slice(0, 16);

  return `${task.slug} [${task.status}]
Title: ${task.title}
Type: ${task.type}
Parent: ${parent}
Created: ${created}
Updated: ${updated}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Help system
// ─────────────────────────────────────────────────────────────────────────────

function showHelp(): void {
  logger.info(`mort - Task management CLI for Mort

USAGE:
  mort <command> [subcommand] [options]

COMMANDS:
  tasks list              List all tasks
  tasks create            Create a new task
  tasks get               Get task details
  tasks rename            Rename a task (updates title and slug)
  tasks update            Update task properties

  request-human           Request human review for a task

GLOBAL OPTIONS:
  --mort-dir <path>       Data directory for mort (default: $MORT_DATA_DIR or ~/.mort)

Both --flag value and --flag=value syntaxes are supported.

Run 'mort tasks <subcommand> --help' for detailed help on each command.
Run 'mort request-human --help' for help on the review command.`);
}

function showTasksHelp(): void {
  logger.info(`mort tasks - Task management commands

SUBCOMMANDS:
  list          List all tasks
  create        Create a new task: --title (required), --status
  get           Get task by --id or --slug
  rename        Rename task: --id, --title
  update        Update task: --id, --status, --parent-id, --repo, --pr-url

OPTIONS:
  --json        Output as JSON (all commands)
  --help        Show help for command

Both --flag value and --flag=value syntaxes are supported.`);
}

const COMMAND_HELP: Record<string, string> = {
  list: `mort tasks list - List all tasks

OPTIONS:
  --json    Output as JSON`,

  create: `mort tasks create - Create a new task

OPTIONS:
  --title       Task title (required, must not be empty)
  --status      Initial status (default: todo)
  --parent-id   Parent task ID
  --repo        Repository name
  --json        Output as JSON`,

  get: `mort tasks get - Get task details

OPTIONS:
  --id      Task ID
  --slug    Task slug (alternative to --id)
  --json    Output as JSON`,

  rename: `mort tasks rename - Rename a task

OPTIONS:
  --id      Task ID (required)
  --title   New title (required)
  --json    Output as JSON`,

  update: `mort tasks update - Update task properties

OPTIONS:
  --id          Task ID (required)
  --status      New status (draft|backlog|todo|in-progress|in-review|done|cancelled)
  --title       New title
  --parent-id   Parent task ID (empty to unset)
  --repo        Repository name
  --pr-url      Pull request URL (set when creating a PR)
  --json        Output as JSON`,

  "request-human": `mort request-human - Request human review for a task

OPTIONS:
  --task         Task ID (required)
  --thread       Thread ID (required) - identifies which agent thread made the request
  --markdown     Markdown content to display (or pipe via stdin)
  --default      Default response text, sent on Enter (default: "Proceed")
  --on-approve   Agent type to spawn when user approves (required)
                 Valid types: research, execution, review, merge
  --on-feedback  Agent type to spawn when user provides feedback (required)
                 Valid types: research, execution, review, merge
  --json         Output as JSON

EXAMPLES:
  # With inline markdown
  mort request-human --task <task-id> --thread <thread-id> --markdown "## Please Review" --on-approve merge --on-feedback execution

  # With stdin
  echo "## Please Review" | mort request-human --task <task-id> --thread <thread-id> --on-approve merge --on-feedback execution

  # With custom default response
  mort request-human --task <task-id> --thread <thread-id> --markdown "Ready?" --default "Start" --on-approve merge --on-feedback execution`,
};

function showCommandHelp(cmd: string): void {
  logger.info(COMMAND_HELP[cmd] || `No help available for '${cmd}'`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

async function tasksList(args: string[]): Promise<void> {
  const useJson = hasFlag(args, "--json");
  logger.debug(`[mort-cli] tasks list: fetching all tasks`);
  const tasks = await persistence.listTasks();
  logger.debug(`[mort-cli] tasks list: found ${tasks.length} tasks`);

  if (useJson) {
    outputJson(tasks);
  } else {
    if (tasks.length === 0) {
      logger.info("No tasks found.");
    } else {
      logger.info(tasks.map(formatTaskLine).join("\n\n"));
    }
  }
}

async function tasksCreate(args: string[]): Promise<void> {
  const useJson = hasFlag(args, "--json");
  const title = getArg(args, "--title");

  if (!title) error("--title is required");
  if (title.trim() === "") error("--title must not be empty");

  const statusArg = getArg(args, "--status");
  const parentId = getArg(args, "--parent-id");
  const repositoryName = getArg(args, "--repo");

  logger.debug(`[mort-cli] tasks create: title="${title}"`);

  try {
    const task = await persistence.createTask({
      title: title.trim(),
      status: statusArg ? validateStatus(statusArg) : undefined,
      parentId: parentId ?? undefined,
      repositoryName,
    });

    events.taskCreated(task.id);

    logger.debug(`[mort-cli] tasks create: SUCCESS - id=${task.id}, slug=${task.slug}`);

    if (useJson) {
      outputJson({
        taskId: task.id,
        slug: task.slug,
        branchName: task.branchName,
        created: true,
      });
    } else {
      logger.info(`Created task: ${task.slug}`);
      logger.info(`  ID: ${task.id}`);
      logger.info(`  Branch: ${task.branchName}`);
    }
  } catch (e) {
    logger.error(`[mort-cli] tasks create: FAILED - ${e instanceof Error ? e.stack : e}`);
    throw e;
  }
}

async function tasksRename(args: string[]): Promise<void> {
  const useJson = hasFlag(args, "--json");
  const id = getArg(args, "--id");
  const title = getArg(args, "--title");

  if (!id) error("--id is required");
  if (id.trim() === "") error("--id must not be empty");
  if (!title) error("--title is required");
  if (title.trim() === "") error("--title must not be empty");

  logger.debug(`[mort-cli] tasks rename: id="${id}", title="${title}"`);

  try {
    const task = await persistence.renameTask(id, title);

    events.taskUpdated(task.id);

    logger.debug(`[mort-cli] tasks rename: SUCCESS - slug=${task.slug}`);

    if (useJson) {
      outputJson({
        taskId: task.id,
        slug: task.slug,
        branchName: task.branchName,
        renamed: true,
      });
    } else {
      logger.info(`Renamed task: ${task.slug}`);
      logger.info(`  Title: ${task.title}`);
      logger.info(`  Branch: ${task.branchName}`);
    }
  } catch (e) {
    logger.error(`[mort-cli] tasks rename: FAILED - ${e instanceof Error ? e.stack : e}`);
    throw e;
  }
}

async function tasksUpdate(args: string[]): Promise<void> {
  const useJson = hasFlag(args, "--json");
  const id = getArg(args, "--id");
  if (!id) error("--id is required");
  if (id.trim() === "") error("--id must not be empty");

  const updates: Record<string, unknown> = {};

  const title = getArg(args, "--title");
  if (title) updates.title = title;

  const statusArg = getArg(args, "--status");
  if (statusArg) updates.status = validateStatus(statusArg);

  const repositoryName = getArg(args, "--repo");
  if (repositoryName) updates.repositoryName = repositoryName;

  const parentId = getArg(args, "--parent-id");
  if (hasFlag(args, "--parent-id")) {
    updates.parentId = parentId ?? null;
  }

  const prUrl = getArg(args, "--pr-url");
  if (prUrl) updates.prUrl = prUrl;

  const task = await persistence.updateTask(id, updates);

  if (updates.status) {
    events.taskStatusChanged(task.id, updates.status as TaskStatus);
  } else {
    events.taskUpdated(task.id);
  }

  if (useJson) {
    outputJson({
      taskId: task.id,
      slug: task.slug,
      updated: true,
      prUrl: prUrl || undefined,
    });
  } else {
    logger.info(`Updated task: ${task.slug}`);
    if (statusArg) logger.info(`  Status: ${task.status}`);
    if (title) logger.info(`  Title: ${task.title}`);
    if (parentId !== undefined) logger.info(`  Parent: ${task.parentId ?? "none"}`);
    if (prUrl) logger.info(`  PR URL: ${prUrl}`);
  }
}

async function tasksGet(args: string[]): Promise<void> {
  const cmdStart = performance.now();
  const useJson = hasFlag(args, "--json");
  const id = getArg(args, "--id");
  const slug = getArg(args, "--slug");

  if (!id && !slug) error("--id or --slug is required");
  if (id && id.trim() === "") error("--id must not be empty");
  if (slug && slug.trim() === "") error("--slug must not be empty");

  let task;
  const taskStart = performance.now();
  if (id) {
    task = await persistence.getTask(id);
    logger.debug(`[tasks get] getTask(id=${id}) took ${(performance.now() - taskStart).toFixed(2)}ms`);
  } else if (slug) {
    task = await persistence.findTaskBySlug(slug);
    logger.debug(`[tasks get] findTaskBySlug(slug=${slug}) took ${(performance.now() - taskStart).toFixed(2)}ms`);
  }

  if (!task) error(`Task not found`);

  if (useJson) {
    outputJson(task);
  } else {
    logger.info(formatTaskDetails(task));

    // Try to include content if available
    const contentStart = performance.now();
    const content = await persistence.getTaskContent(task.id);
    logger.debug(`[tasks get] getTaskContent(id=${task.id}) took ${(performance.now() - contentStart).toFixed(2)}ms`);
    if (content) {
      logger.info(`\nContent:\n---\n${content}`);
    }
  }

  logger.debug(`[tasks get] total command time: ${(performance.now() - cmdStart).toFixed(2)}ms`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stdin reading helper
// ─────────────────────────────────────────────────────────────────────────────

const STDIN_TIMEOUT_MS = 5_000; // 5 seconds for stdin

async function readStdin(): Promise<string> {
  // Only read if stdin is not a TTY (i.e., data is piped)
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      logger.error(
        `[mort-cli] TIMEOUT: readStdin exceeded ${STDIN_TIMEOUT_MS}ms`
      );
      process.stdin.destroy();
      reject(new TimeoutError("Reading stdin", STDIN_TIMEOUT_MS));
    }, STDIN_TIMEOUT_MS);

    process.stdin.on("data", (chunk) => chunks.push(chunk as Buffer));
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8").trim());
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Human Command
// ─────────────────────────────────────────────────────────────────────────────

async function requestHuman(args: string[]): Promise<void> {
  const taskId = getArg(args, "--task");
  const threadId = getArg(args, "--thread");
  const markdownArg = getArg(args, "--markdown");
  const defaultResponse = getArg(args, "--default") ?? "Proceed";
  const onApproveArg = getArg(args, "--on-approve");
  const onFeedbackArg = getArg(args, "--on-feedback");

  if (!taskId) error("--task is required");
  if (taskId.trim() === "") error("--task must not be empty");
  if (!threadId) error("--thread is required");
  if (threadId.trim() === "") error("--thread must not be empty");

  // Validate required agent type flags
  if (!onApproveArg) error("--on-approve is required");
  if (!onFeedbackArg) error("--on-feedback is required");

  // Validate agent types
  const onApprove = validateAgentType(onApproveArg);
  const onFeedback = validateAgentType(onFeedbackArg);

  // Get markdown from --markdown arg or stdin
  let markdown = markdownArg;
  if (!markdown) {
    markdown = await readStdin();
  }

  if (!markdown || markdown.trim() === "") {
    error("--markdown is required (or pipe content via stdin)");
  }

  logger.debug(`[mort-cli] request-human: task="${taskId}", thread="${threadId}", markdown length=${markdown.length}, onApprove=${onApprove}, onFeedback=${onFeedback}`);

  try {
    // Update task with pending review using addPendingReview operation
    // NOTE: The persistence layer generates the unique `id` field for each review entry
    const task = await persistence.updateTask(taskId, {
      addPendingReview: {
        threadId,
        markdown,
        defaultResponse,
        requestedAt: Date.now(),
        onApprove,
        onFeedback,
        isAddressed: false,
      },
    });

    events.actionRequested(task.id, markdown, defaultResponse);

    logger.debug(`[mort-cli] request-human: SUCCESS - task ${task.slug} updated with pendingReview`);

    // Always output JSON so the app can detect the mutation and refresh
    // The slug is required for the app to know which task to refresh
    outputJson({
      taskId: task.id,
      slug: task.slug,
      reviewRequested: true,
      defaultResponse,
    });
  } catch (e) {
    logger.error(`[mort-cli] request-human: FAILED - ${e instanceof Error ? e.stack : e}`);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeout-wrapped command functions
// ─────────────────────────────────────────────────────────────────────────────

const tasksListWithTimeout = withCliTimeout(tasksList, "tasks list");
const tasksCreateWithTimeout = withCliTimeout(tasksCreate, "tasks create");
const tasksRenameWithTimeout = withCliTimeout(tasksRename, "tasks rename");
const tasksUpdateWithTimeout = withCliTimeout(tasksUpdate, "tasks update");
const tasksGetWithTimeout = withCliTimeout(tasksGet, "tasks get");
const requestHumanWithTimeout = withCliTimeout(requestHuman, "request-human");

// ─────────────────────────────────────────────────────────────────────────────
// Main router
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, subcommand] = args;
  const rest = args.slice(2);

  // Handle bare command and help flags
  if (!command || command === "help" || command === "--help") {
    showHelp();
    process.exit(0);
  }

  if (command === "tasks") {
    // Handle tasks help
    if (!subcommand || subcommand === "--help") {
      showTasksHelp();
      process.exit(0);
    }

    // Check for --help flag in any subcommand
    if (rest.includes("--help")) {
      showCommandHelp(subcommand);
      process.exit(0);
    }

    switch (subcommand) {
      case "list":
        await tasksListWithTimeout(rest);
        break;
      case "create":
        await tasksCreateWithTimeout(rest);
        break;
      case "rename":
        await tasksRenameWithTimeout(rest);
        break;
      case "update":
        await tasksUpdateWithTimeout(rest);
        break;
      case "get":
        await tasksGetWithTimeout(rest);
        break;
      default:
        error(`Unknown subcommand: ${subcommand}. Available: list, create, rename, update, get`);
    }
  } else if (command === "request-human") {
    // request-human is a top-level command, not a subcommand of tasks
    const rest = args.slice(1);

    // Check for --help flag
    if (rest.includes("--help")) {
      showCommandHelp("request-human");
      process.exit(0);
    }

    await requestHumanWithTimeout(rest);
  } else {
    error(`Unknown command: ${command}. Available: tasks, request-human`);
  }
}

main().catch((e) => {
  logger.error(`[mort-cli] Unhandled error: ${e instanceof Error ? e.stack : e}`);
  error(e instanceof Error ? e.message : String(e));
});
