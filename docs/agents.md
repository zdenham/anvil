# Agent Guidelines

Anvil is a coding agent orchestrator built on Claude Code. It enables developers to run many parallel agents in isolated environments, accelerating development workflows at scale.

This document defines how you should write code for this codebase. Follow these guidelines strictly.

## Data Models

See [data-models.md](./data-models.md) for the core domain models: Task, Thread, Repository, Worktree, and Branch.

## Architecture Patterns

These patterns are essential for maintaining consistency in a multi-writer environment (UI + agents).

**[Adapters](./patterns/adapters.md)**
- Dependency injection for sharing code between Tauri frontend and Node.js agents.
- Read when writing services shared between Node and Tauri, or adding filesystem/git operations.

**[Disk as Truth](./patterns/disk-as-truth.md)**
- The filesystem is the single source of truth. Cache minimally, refresh liberally.
- Read when dealing with state management, caching, or data synchronization between processes.

**[Event Bridge](./patterns/event-bridge.md)**
- Bridges events between Node agents and Tauri windows. Events are signals, not data carriers.
- Read when emitting or subscribing to events, or debugging cross-process communication.

**[Entity Stores](./patterns/entity-stores.md)**
- Zustand stores with single-copy-per-entity rule and strict data flow.
- Read when adding new entities, modifying stores, or changing how data flows from disk to UI.

**[YAGNI](./patterns/yagni.md)**
- Delete dead code aggressively. Unused code pollutes AI context.
- Read when refactoring, removing features, or deciding whether to add abstractions.

**[Zod at Boundaries](./patterns/zod-boundaries.md)**
- Use Zod for runtime validation only where data crosses trust boundaries (disk, network, IPC).
- Read when adding new types, deciding between Zod schemas and TypeScript interfaces, or loading external data.

**[Type Layering](./patterns/type-layering.md)**
- Imports flow inward: `src/` → `agents/` → `core/`. Never the reverse.
- Read when adding shared types or importing across package boundaries.

## All Code Must be Verifiable

The most important thing to do when writing code is to verify your results.

Static analysis is insufficient, you must PROVE that your code works with tests, and by running the tests with expected results.

Unit tests are insufficient, you must also test the interfaces between services with integration tests.

You must prove your diagnosis of issues by reproducing or analyzing logs. Logs can be found at logs/dev.log

See [testing.md](./testing.md) for test commands, frameworks, and how to write tests.

## General Coding Practices

- use kebab-case for file names wherever possible
- Files should remain below 250 lines of code. If you exceed 250 lines, break it down into submodules.
- Functions should remain below 50 lines of code. If a function exceeds 50 lines of code, break it down into submodules.
- Prefer using typescript classes where possible.
- Prefer early return / throw for unhappy paths instead of nested if blocks for happy paths
- Throw errors liberally, expect the caller to catch errors
- Document choices which are not self explanatory or intuitive
- Seek to write testable code and follow SOLID principles

## Single Responsibility

Each service and class should have **one clear purpose**. This is critical for maintainability and testability.

- If a class is doing multiple unrelated things, split it into focused, single-purpose components
- Services should own a single domain concern—avoid "god services" that handle everything
- When a class needs functionality from another domain, inject it as a dependency rather than implementing it inline
- A good test: if you can't describe what a class does in one sentence without using "and", it's doing too much

## Thin Rust

- Our team is more familiar with typescript than rust
- We typically will want to maximize typescript usage for business logic, with the exception of features that need very low latency
- When we do use rust, we'd like to keep it pretty low level, and maximize performance

## Typescript Rules

- Use strong types, avoid using any or casts
- Prefer existing types instead of declaring new ones
- Look for types declared in libraries rather than declaring our own

## Use stable references

- Always key by task-id or slug-id NOT by slugs or folder paths
- Slugs and folder paths are unstable and can change, we must always key by stable ids

## React Rules

- Separate logic into pure functions and classes wherever possible, avoid leaning too heavily on react constructs for logic.
- Avoid unnecessary useEffects, especially for deriving state.

## Agent Process Architecture

Prefer putting business logic in the Node agent process over Tauri:

- **Easier testing** - Node can run headlessly without the full Tauri app
- **Leaner UI** - Tauri frontend should be event-driven, reacting to agent events rather than orchestrating
- **Reduced complexity** - Avoids round-trips between frontend → Rust → Node

After spawning an agent, the Tauri UI should primarily listen and react to events.

## Platform Specific Code

We only plan to support MacOS initially, so avoid any vendor specific code with platform checks.

## Plans

Create plans in the `plans/` directory as kebab-cased `.md` files. Research thoroughly and ask clarifying questions before writing.

## Logging

Never use `println!`, `eprintln!`, or `console.log`.

- **Rust**: `use tracing::{info, warn, error, debug};`
- **TypeScript**: `import { logger } from "@/lib/logger-client";`

See [logs.md](./logs.md) for log locations and how to read them safely without polluting context.
