# Contributing to Anvil

Thanks for your interest in contributing to Anvil! This guide will help you get set up and explain how we work.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9+)
- [Rust](https://rustup.rs/) (stable toolchain)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) (`cargo install tauri-cli`)

### macOS

Xcode Command Line Tools are required:

```bash
xcode-select --install
```

### Linux

Install system dependencies for Tauri:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Getting Started

```bash
# Clone and install dependencies
git clone https://github.com/zdenham/anvil.git
cd anvil
pnpm install

# Start development (builds all workspaces + launches Tauri)
pnpm dev
```

The `pnpm dev` command starts the agents, SDK, migrations, and sidecar workspaces in watch mode alongside the Tauri development server.

## Project Structure

```
anvil/
  src/              # Frontend (React + TypeScript)
  src-tauri/        # Tauri backend (Rust)
  core/             # Shared types, adapters, SDK, services
  agents/           # Agent workspace package
  server/           # Backend server (gateway, routes, migrations)
  api/              # Fastify API server
  sidecar/          # Sidecar process
  migrations/       # Database migrations
  landing/          # Marketing site
```

## Running Tests

```bash
# Unit + integration tests
pnpm test

# Watch mode
pnpm test:watch

# UI component tests
pnpm test:ui

# E2E tests (requires a running dev server)
pnpm test:e2e

# Critical-path E2E only
pnpm test:e2e:critical
```

## Linting

```bash
pnpm lint        # Check for issues
pnpm lint:fix    # Auto-fix
```

## Submitting Changes

1. Fork the repository and create a branch from `main`
2. Make your changes in small, focused commits
3. Add tests for new functionality
4. Ensure `pnpm test` and `pnpm lint` pass
5. Open a pull request with a clear description of what changed and why

## Code Style

- TypeScript strict mode is enforced
- Use Vitest for unit and integration tests
- Prefer named exports over default exports
- Keep files focused and under 250 lines (see `docs/agents.md`); break larger files into submodules

## Reporting Issues

Open an issue on GitHub with:

- Steps to reproduce
- Expected vs. actual behavior
- OS and Anvil version
- Relevant logs (from `logs/dev.log` if running in dev mode)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
