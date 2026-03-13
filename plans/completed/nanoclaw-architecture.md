# Nanoclaw Architecture Walkthrough

> Analysis of [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw) — a lightweight personal AI assistant built on the Claude Agent SDK that runs agents in isolated containers and connects to messaging platforms.
>
> Local clone: `/tmp/nanoclaw`

## Overview

Nanoclaw is \~15 source files, a single Node.js host process, and OS-level container isolation. Channels (WhatsApp, Telegram, etc.) self-register at startup. Messages flow through a queue into isolated containers where Claude agents execute with filesystem-scoped memory.

---

## 1. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         HOST PROCESS (Node.js)                       │
│                                                                      │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐  │
│  │WhatsApp │ │ Telegram │ │  Slack  │ │ Discord  │ │  Gmail    │  │
│  │ Channel │ │ Channel  │ │ Channel │ │ Channel  │ │ Channel   │  │
│  └────┬────┘ └────┬─────┘ └────┬────┘ └────┬─────┘ └─────┬─────┘  │
│       │           │            │            │             │          │
│       └───────────┴─────┬──────┴────────────┴─────────────┘          │
│                         │ onMessage()                                │
│                         ▼                                            │
│                  ┌─────────────┐                                     │
│                  │  SQLite DB  │  messages, sessions, tasks, state   │
│                  └──────┬──────┘                                     │
│                         │                                            │
│        ┌────────────────┼────────────────┐                           │
│        ▼                ▼                ▼                           │
│  ┌───────────┐  ┌─────────────┐  ┌────────────┐                    │
│  │  Message   │  │  Scheduler  │  │    IPC     │                    │
│  │   Loop     │  │    Loop     │  │  Watcher   │                    │
│  │  (2s poll) │  │ (60s poll)  │  │  (1s poll) │                    │
│  └─────┬─────┘  └──────┬──────┘  └─────┬──────┘                    │
│        │               │               │                            │
│        └───────────────┬┘               │                            │
│                        ▼                │                            │
│                 ┌─────────────┐         │                            │
│                 │ Group Queue │◄────────┘                            │
│                 │ (max 5      │  IPC results: send_message,          │
│                 │  concurrent)│  schedule_task, register_group        │
│                 └──────┬──────┘                                      │
│                        │                                             │
│                        ▼                                             │
│              ┌──────────────────┐    stdin (JSON)                    │
│              │ Container Runner │───────────────┐                    │
│              │ (spawn + stream) │               │                    │
│              └──────────────────┘               │                    │
│                        ▲                        │                    │
│                        │ stdout (marked JSON)   │                    │
├────────────────────────┼────────────────────────┼────────────────────┤
│                        │     CONTAINER BOUNDARY  │                    │
│                        │    (Apple Container /   │                    │
│                        │     Docker)             │                    │
│               ┌────────┴────────────────────────┴──────────┐        │
│               │                                             │        │
│               │   ┌─────────────────┐                      │        │
│               │   │  Agent Runner   │  (Node.js)           │        │
│               │   │                 │                      │        │
│               │   │  MessageStream ─┼─▶ query() ──▶ Claude │        │
│               │   │  (async iter)   │      API             │        │
│               │   │                 │                      │        │
│               │   │  IPC Poller ────┼─▶ /workspace/ipc/    │        │
│               │   │  (500ms)        │   input/ (host→agent)│        │
│               │   │                 │                      │        │
│               │   │  MCP Server ────┼─▶ /workspace/ipc/    │        │
│               │   │  (nanoclaw)     │   messages/ tasks/   │        │
│               │   └─────────────────┘   (agent→host)       │        │
│               │                                             │        │
│               │   Volume Mounts:                            │        │
│               │   /workspace/group  → groups/{name}/        │        │
│               │   /workspace/global → groups/ (read-only)   │        │
│               │   /workspace/ipc    → data/ipc/{group}/     │        │
│               │   /home/node/.claude→ data/sessions/{group}/│        │
│               └─────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Startup Sequence

```
src/index.ts:468-585

    ┌──────────────────────────┐
    │ ensureContainerRuntime() │  Verify Docker/Apple Container available
    │ cleanupOrphans()         │  Kill leftover containers from prior crash
    └────────────┬─────────────┘
                 ▼
    ┌──────────────────────────┐
    │ initDatabase()           │  Open/create SQLite, run migrations
    └────────────┬─────────────┘
                 ▼
    ┌──────────────────────────┐
    │ loadState()              │  Restore from DB:
    │                          │  - last_timestamp (polling cursor)
    │                          │  - last_agent_timestamp per group
    │                          │  - session IDs per group
    │                          │  - registered groups
    └────────────┬─────────────┘
                 ▼
    ┌──────────────────────────┐
    │ Start credential proxy   │  HTTP on :3001 — containers route
    │                          │  API calls through this to avoid
    │                          │  embedding real keys in containers
    └────────────┬─────────────┘
                 ▼
    ┌──────────────────────────┐
    │ Connect channels         │  For each registered channel:
    │                          │    factory(opts) → Channel | null
    │                          │    channel.connect()
    │                          │  Channels that lack credentials
    │                          │  return null and are skipped
    └────────────┬─────────────┘
                 ▼
    ┌──────────────────────────┐
    │ Start subsystems         │
    │  • startSchedulerLoop()  │  Poll for due tasks every 60s
    │  • startIpcWatcher()     │  Poll IPC dirs every 1s
    │  • queue.setProcessFn()  │  Wire up message handler
    └────────────┬─────────────┘
                 ▼
    ┌──────────────────────────┐
    │ Recover unprocessed      │  Scan for messages stored but
    │                          │  not yet agent-processed
    └────────────┬─────────────┘
                 ▼
    ┌──────────────────────────┐
    │ Enter main message loop  │  while(true) { poll every 2s }
    └──────────────────────────┘
```

---

## 3. Message Lifecycle (End-to-End)

```
 User sends "Hey @Andy what's the weather?"
 in a WhatsApp group
           │
           ▼
 ┌─────────────────────┐
 │ WhatsApp Channel     │  Receives via webhook/socket
 │ onMessage(jid, msg)  │
 └──────────┬──────────┘
            ▼
 ┌─────────────────────┐
 │ Store in SQLite      │  messages table (content, sender, timestamp)
 │ storeMessage(msg)    │
 └──────────┬──────────┘
            ▼
 ┌─────────────────────┐
 │ Message Loop         │  Polls every 2s, sees new message
 │ getNewMessages()     │  for this group since last_timestamp
 └──────────┬──────────┘
            ▼
 ┌─────────────────────┐
 │ Trigger check        │  Non-main groups: does message
 │                      │  contain trigger word (@Andy)?
 │                      │  Main group: always triggers
 └──────────┬──────────┘
            ▼
 ┌─────────────────────┐
 │ queue.enqueue        │  If container slot available
 │  MessageCheck(jid)   │  (< MAX_CONCURRENT=5), proceed.
 │                      │  Otherwise, queue for later.
 └──────────┬──────────┘
            ▼
 ┌──────────────────────────────────────────────┐
 │ processGroupMessages(chatJid)                 │
 │                                               │
 │  1. Fetch messages since last_agent_timestamp │
 │  2. Format as XML:                            │
 │     <message from="Alice" time="14:32">       │
 │       Hey @Andy what's the weather?           │
 │     </message>                                │
 │  3. Write tasks.json, groups.json to disk     │
 └────────────────────┬─────────────────────────┘
                      ▼
 ┌──────────────────────────────────────────────┐
 │ runContainerAgent(group, prompt, jid)         │
 │                                               │
 │  Build container with volume mounts:          │
 │  • Group folder (r/w)                         │
 │  • Global folder (read-only for non-main)     │
 │  • Sessions dir (r/w)                         │
 │  • IPC namespace (r/w)                        │
 │                                               │
 │  Pipe prompt JSON to container stdin          │
 └────────────────────┬─────────────────────────┘
                      ▼
 ┌──────────────────────────────────────────────┐
 │ INSIDE CONTAINER                              │
 │                                               │
 │  Agent Runner reads stdin                     │
 │  → pushes to MessageStream                   │
 │  → query() calls Anthropic API               │
 │  → Claude reasons + uses tools               │
 │  → MCP tools: send_message, schedule_task    │
 │  → Writes output JSON to stdout              │
 │    (delimited by NANOCLAW_OUTPUT markers)     │
 └────────────────────┬─────────────────────────┘
                      ▼
 ┌──────────────────────────────────────────────┐
 │ Host streams stdout                           │
 │  Parse output JSON chunks                     │
 │  → channel.sendMessage(jid, text)             │
 │  → WhatsApp delivers reply to group           │
 └────────────────────┬─────────────────────────┘
                      ▼
 ┌──────────────────────────────────────────────┐
 │ Cleanup                                       │
 │  • Update last_agent_timestamp for group      │
 │  • Save session ID for resume                 │
 │  • queue.notifyIdle() → start idle timer      │
 │  • After 30min idle OR new task: close stdin   │
 │  • Drain queue: process pending groups         │
 └──────────────────────────────────────────────┘
```

---

## 4. Memory Model

```
 ┌──────────────────────────────────────────────────────────────┐
 │                        DISK LAYOUT                           │
 │                                                              │
 │  groups/                                                     │
 │  ├── CLAUDE.md              ◄── GLOBAL MEMORY                │
 │  │                              Read by ALL groups           │
 │  │                              Written by MAIN group only   │
 │  │                                                           │
 │  ├── whatsapp_family/       ◄── GROUP FOLDER                 │
 │  │   ├── CLAUDE.md              Group-specific memory        │
 │  │   ├── notes.md               Agent-created files          │
 │  │   └── logs/                  Task execution logs          │
 │  │                                                           │
 │  ├── telegram_work/                                          │
 │  │   ├── CLAUDE.md                                           │
 │  │   └── ...                                                 │
 │  │                                                           │
 │  └── slack_devops/                                           │
 │      ├── CLAUDE.md                                           │
 │      └── ...                                                 │
 │                                                              │
 │  data/                                                       │
 │  ├── sessions/{group}/      ◄── SESSION STATE                │
 │  │   └── .claude/               Claude SDK session data      │
 │  │       ├── settings.json      (enables swarms, etc.)       │
 │  │       └── ...                Session transcripts          │
 │  │                                                           │
 │  └── nanoclaw.db            ◄── SQLITE                       │
 │      • messages (chat history)                               │
 │      • sessions (session ID per group)                       │
 │      • scheduled_tasks                                       │
 │      • router_state (polling cursors)                        │
 │      • registered_groups                                     │
 └──────────────────────────────────────────────────────────────┘

 HOW MEMORY IS INJECTED INTO AGENT CONTEXT:
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │  Container volume mounts:                                    │
 │    groups/{name}/     → /workspace/group    (cwd)            │
 │    groups/            → /workspace/global   (read-only*)     │
 │    data/sessions/{g}/ → /home/node/.claude                   │
 │                                                              │
 │  SDK loads CLAUDE.md automatically via settingSources:       │
 │    /workspace/group/CLAUDE.md   → group memory               │
 │    /workspace/global/CLAUDE.md  → global memory (parent dir) │
 │                                                              │
 │  Agent reads/writes CLAUDE.md to persist memories:           │
 │    ./CLAUDE.md         → group-scoped (always writable)      │
 │    ../CLAUDE.md        → global (writable only for main)     │
 │                                                              │
 │  * Non-main groups get global mounted read-only              │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘

 MEMORY ISOLATION:
 ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
 │  Family Group   │  │   Work Group    │  │  DevOps Group   │
 │                 │  │                 │  │                 │
 │ Can read:       │  │ Can read:       │  │ Can read:       │
 │ • Own CLAUDE.md │  │ • Own CLAUDE.md │  │ • Own CLAUDE.md │
 │ • Global mem    │  │ • Global mem    │  │ • Global mem    │
 │                 │  │                 │  │                 │
 │ Can write:      │  │ Can write:      │  │ Can write:      │
 │ • Own CLAUDE.md │  │ • Own CLAUDE.md │  │ • Own CLAUDE.md │
 │ • Own files     │  │ • Own files     │  │ • Own files     │
 └─────────────────┘  └─────────────────┘  └─────────────────┘

 ┌─────────────────┐
 │  Main Group     │  ← Special privileges
 │                 │
 │ Can read:       │
 │ • Own CLAUDE.md │
 │ • Global mem    │
 │ • Project root  │  (read-only mount of host project)
 │                 │
 │ Can write:      │
 │ • Own CLAUDE.md │
 │ • Global mem    │  ← Only main can write global
 │ • Own files     │
 └─────────────────┘
```

---

## 5. Concurrency & Queue Model

```
 ┌──────────────────────────────────────────────────────────────┐
 │                     GROUP QUEUE                              │
 │                     src/group-queue.ts                       │
 │                                                              │
 │  Global: activeCount / MAX_CONCURRENT_CONTAINERS (default 5) │
 │                                                              │
 │  Per-group state machine:                                    │
 │                                                              │
 │    ┌──────────┐  enqueue   ┌──────────┐                     │
 │    │          │──────────▶│          │                      │
 │    │  IDLE    │           │ ACTIVE   │ Container running    │
 │    │          │◀──────────│          │ Processing messages  │
 │    └──────────┘  drain    └─────┬────┘                      │
 │         ▲                       │                            │
 │         │                       │ agent sends response       │
 │         │                       ▼                            │
 │         │               ┌──────────────┐                    │
 │         │               │ IDLE_WAITING │ Container alive,   │
 │         │               │              │ waiting for more   │
 │         │               │ (30min timer)│ messages via IPC   │
 │         │               └──────┬───────┘                    │
 │         │                      │                             │
 │         │         ┌────────────┼────────────┐               │
 │         │         ▼            ▼            ▼               │
 │         │    New message   Scheduled    30min timeout        │
 │         │    arrives       task due     expires              │
 │         │         │            │            │                │
 │         │         ▼            ▼            ▼                │
 │         │    Pipe to IPC   Close stdin  Close stdin          │
 │         │    (reuse        + re-enqueue + cleanup            │
 │         │     container)                                     │
 │         └───────────────────────────────────┘               │
 │                                                              │
 │  When a slot frees up:                                       │
 │    1. drainGroup() — check this group for pending work       │
 │    2. drainWaiting() — dequeue next waiting group            │
 └──────────────────────────────────────────────────────────────┘
```

---

## 6. IPC: Host ↔ Container Communication

```
 HOST                              CONTAINER
 ────                              ─────────

 Initial prompt via stdin:
 ──────────────────────────────────────────────▶
 { prompt, sessionId, groupFolder,
   chatJid, isMain, assistantName }


 Streaming results via stdout:
 ◀──────────────────────────────────────────────
 ---NANOCLAW_OUTPUT_START---
 { "type":"text", "content":"The weather is..." }
 ---NANOCLAW_OUTPUT_END---


 Follow-up messages (user sends more while agent is running):
 ──────────────────────────────────────────────▶
 Host writes JSON to: data/ipc/{group}/input/
 Agent polls /workspace/ipc/input/ every 500ms
 Agent pushes into MessageStream → new query() turn


 Agent-initiated actions (via MCP server tools):
 ◀──────────────────────────────────────────────
 Agent writes JSON to: /workspace/ipc/messages/ or /workspace/ipc/tasks/
 Host polls data/ipc/{group}/ every 1s

 IPC message types:
 ┌────────────────────────────────────────────────────────────┐
 │  messages/  → send_message (to any authorized group)      │
 │  tasks/     → schedule_task, pause_task, resume_task,     │
 │               cancel_task, update_task, refresh_groups,    │
 │               register_group (main only)                   │
 └────────────────────────────────────────────────────────────┘

 Authorization rules:
 ┌────────────────────────────────────────────────────────────┐
 │  Same group    → always allowed                           │
 │  Main group    → can message any group                    │
 │  Other groups  → can only message themselves              │
 └────────────────────────────────────────────────────────────┘


 Shutdown:
 ──────────────────────────────────────────────▶
 Host writes _close sentinel to input/
 Agent sees _close → ends MessageStream → query() finishes
 Container exits
```

---

## 7. Scheduled Tasks Lifecycle

```
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │  CREATION (via MCP tool in container):                       │
 │                                                              │
 │  Agent calls schedule_task tool                              │
 │  → MCP server writes JSON to /workspace/ipc/tasks/          │
 │  → Host IPC watcher picks it up                              │
 │  → Inserts into scheduled_tasks table                        │
 │  → Computes next_run based on schedule_type                  │
 │                                                              │
 │  Schedule types:                                             │
 │  ┌──────────┬─────────────────────┬────────────────────────┐│
 │  │ cron     │ "0 9 * * 1"        │ Next Monday 9am       ││
 │  │ interval │ "3600000"          │ Every hour (ms)        ││
 │  │ once     │ ISO timestamp      │ Single future time     ││
 │  └──────────┴─────────────────────┴────────────────────────┘│
 │                                                              │
 │  EXECUTION LOOP (src/task-scheduler.ts, every 60s):         │
 │                                                              │
 │    getDueTasks()                                             │
 │    │  SELECT * FROM scheduled_tasks                          │
 │    │  WHERE next_run <= now AND status = 'active'            │
 │    ▼                                                         │
 │    For each due task:                                        │
 │      1. queue.enqueueTask(chatJid, taskId, runTask)          │
 │      2. runTask spawns container with task prompt             │
 │      3. context_mode='group' → resumes group session         │
 │         context_mode='isolated' → fresh session              │
 │      4. Stream output (or suppress with <internal> tags)     │
 │      5. Log to task_run_logs table                           │
 │      6. Compute and save next_run                            │
 │         (once → null/completed, cron/interval → next time)   │
 │                                                              │
 │  DRIFT PREVENTION (interval tasks):                         │
 │    next = task.next_run + interval_ms                        │
 │    while (next <= now) next += interval_ms                   │
 │    // Anchors to scheduled time, not completion time         │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘
```

---

## 8. Channel Self-Registration

```
 src/channels/registry.ts          src/channels/whatsapp.ts
 ┌───────────────────────┐         ┌───────────────────────────────┐
 │                       │         │                               │
 │ const registry =      │◀────────│ registerChannel('whatsapp',   │
 │   Map<string,Factory> │  import │   (opts) => {                 │
 │                       │  time   │     if (!creds) return null;  │
 │ registerChannel(name, │         │     return new WhatsApp(opts);│
 │   factory)            │         │   }                           │
 │                       │         │ );                            │
 │ getRegistered         │         │                               │
 │   ChannelNames()      │         └───────────────────────────────┘
 │                       │
 │ getChannelFactory(    │         src/channels/index.ts (barrel)
 │   name)               │         ┌───────────────────────────────┐
 │                       │         │ import './whatsapp.js';       │
 └───────────────────────┘         │ import './telegram.js';       │
                                   │ import './slack.js';          │
                                   │ // each triggers register()   │
 At startup (src/index.ts):        └───────────────────────────────┘
 ┌─────────────────────────────────────────────────────┐
 │ for (const name of getRegisteredChannelNames()) {   │
 │   const channel = getChannelFactory(name)(opts);    │
 │   if (channel) {          // null = missing creds   │
 │     channels.push(channel);                         │
 │     await channel.connect();                        │
 │   }                                                 │
 │ }                                                   │
 └─────────────────────────────────────────────────────┘

 Adding a new channel is a Claude Code skill (e.g. /add-telegram):
 1. Creates src/channels/{name}.ts with registerChannel() call
 2. Adds import to src/channels/index.ts barrel
 3. Done — orchestrator picks it up next startup
```

---

## 9. Container Security Model

```
 ┌──────────────────────────────────────────────────────────────┐
 │                    SECURITY BOUNDARIES                        │
 │                                                              │
 │  ┌────────────────────────────────────────────────────────┐  │
 │  │  HOST                                                  │  │
 │  │                                                        │  │
 │  │  • Holds real API keys (never passed to containers)    │  │
 │  │  • Credential proxy on :3001 validates + forwards      │  │
 │  │  • IPC watcher enforces authorization rules            │  │
 │  │  • Mount allowlist prevents escaping to arbitrary paths │  │
 │  └────────────────────────────────────────────────────────┘  │
 │                          │                                   │
 │                    OS-level isolation                         │
 │                  (Apple Container / Docker)                   │
 │                          │                                   │
 │  ┌────────────────────────────────────────────────────────┐  │
 │  │  CONTAINER                                             │  │
 │  │                                                        │  │
 │  │  • Filesystem isolation (only mounted volumes visible)  │  │
 │  │  • Network restricted to credential proxy              │  │
 │  │  • API key = "placeholder" (proxy substitutes real key) │  │
 │  │  • Non-root user (host UID:GID mapped)                 │  │
 │  │  • Read-only mounts for global memory (non-main)       │  │
 │  │  • Container auto-removed on exit (--rm)               │  │
 │  └────────────────────────────────────────────────────────┘  │
 │                                                              │
 │  Key principle: Agent code runs with full autonomy INSIDE    │
 │  the container, but the container itself is constrained.     │
 │  This is OS-level sandboxing, not application-level checks.  │
 └──────────────────────────────────────────────────────────────┘
```

---

## 10. Key Source Files

| File | Lines | Purpose |
| --- | --- | --- |
| `src/index.ts` | \~600 | Orchestrator: startup, message loop, agent invocation |
| `src/container-runner.ts` | \~500 | Build volumes, spawn containers, stream I/O |
| `src/group-queue.ts` | \~365 | Per-group concurrency, idle management, drain logic |
| `src/task-scheduler.ts` | \~280 | Cron/interval/once scheduling, drift prevention |
| `src/ipc.ts` | \~455 | Host-side IPC polling, authorization, dispatch |
| `src/db.ts` | \~700 | SQLite schema, migrations, CRUD operations |
| `src/router.ts` | \~53 | Message formatting (XML), channel routing |
| `src/channels/registry.ts` | \~30 | Channel self-registration pattern |
| `src/config.ts` | \~74 | Constants (poll intervals, timeouts, paths) |
| `src/types.ts` | \~108 | TypeScript interfaces |
| `container/agent-runner/src/index.ts` | \~365 | In-container agent loop, MessageStream, SDK query() |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | \~250 | MCP server: send_message, schedule_task tools |

---

## Sources

- [qwibitai/nanoclaw on GitHub](https://github.com/qwibitai/nanoclaw)