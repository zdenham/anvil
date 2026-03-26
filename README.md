<p align="center">
  <img src="logo-rounded.png" alt="Anvil" width="128" height="128" />
</p>

<h1 align="center">Anvil</h1>

<p align="center">
  <em>More agents, less pain.</em>
</p>

<p align="center">
  A desktop IDE for running coding agents in parallel.<br/>
  No terminal juggling. No alt-tabbing. One window, all your agents.
</p>

<p align="center">
  <a href="https://discord.gg/tbkAetedSd">Discord</a> ·
  <a href="https://github.com/zdenham/anvil/releases">Download</a>
</p>

---

## Features

- **Workspace management** — Isolated worktrees let you parallelize without merge conflicts.
- **First-class spec support** — The best UX for plan-driven development. Refine and execute plans in one click.
- **Full IDE** — Terminal, file editor, diff viewer — everything you need in one window.
- **REPL & orchestration** — Scriptable agent composition. Flexible building blocks, not rigid workflows.
- **Sub-agent visibility** — No more black boxes. See what child and grandchild agents are actually doing.
- **Visual arrangement** — Up to a 4×3 grid of agent panels. Your workspace, your layout.

## Install

Download the latest release for macOS from [Releases](https://github.com/zdenham/anvil/releases).

## Development

Built with Tauri + React + TypeScript.

```bash
pnpm install
pnpm dev
```

## Testing

```bash
pnpm test              # unit + integration tests
cd agents && pnpm test # agent-specific tests
```

## License

[MIT](LICENSE)
