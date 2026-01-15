# Logs

## Log Locations

- **Human-readable logs**: `logs/dev.log`
- **Structured logs**: `logs/structured.jsonl` (JSON lines format with detailed metadata)

## Reading Logs Safely

Logs can grow large quickly. **Do not read entire log files into context.** Use search and tail to find relevant entries:

```bash
# View recent logs
tail -100 logs/dev.log

# Search for specific terms
grep "error" logs/dev.log | tail -50
grep "task-id-here" logs/structured.jsonl | tail -20

# Search with context
grep -A 2 -B 2 "pattern" logs/dev.log | tail -100
```

## Structured Logs

`logs/structured.jsonl` contains JSON objects with rich metadata. Use `jq` to query:

```bash
# Recent errors
tail -500 logs/structured.jsonl | jq 'select(.level == "ERROR")'

# Filter by component
tail -500 logs/structured.jsonl | jq 'select(.target | contains("worktree"))'

# Filter by task
grep "task-id-here" logs/structured.jsonl | jq '.'
```

## Best Practices

1. **Start with tail** - Always limit output with `tail` before reading
2. **Filter first** - Use grep/jq to narrow down before expanding context
3. **Use structured logs for debugging** - They contain more metadata than dev.log
4. **Check recent logs first** - Problems are usually in the most recent entries
