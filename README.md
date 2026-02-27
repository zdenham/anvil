# Mort

A coding agent orchestrator built on Claude Code. Enables developers to run many parallel agents in isolated environments, accelerating development workflows at scale.

Built with Tauri + React + TypeScript.

## Internal Distribution

```
curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/distribute_internally.sh | bash
```

## Development

```bash
pnpm install
pnpm dev
```

## Testing

```bash
pnpm test           # unit + integration tests
cd agents && pnpm test  # agent-specific tests
```

hello world
