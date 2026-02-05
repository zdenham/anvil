# Sub-Agent Integration Testing Guide

Guide for running sub-agent integration tests in the `agents` package.

## Running Tests

The API key is in `.env`. Put the file path **before** options (no `--` separator needed).

### Run All Sub-Agent Tests

```bash
cd agents && source ../.env && pnpm test src/testing/__tests__/sub-agent.integration.test.ts
```

### Run a Specific Test by Name

Use `--testNamePattern` to match test names:

```bash
cd agents && source ../.env && pnpm test src/testing/__tests__/sub-agent.integration.test.ts --testNamePattern="your test name"
```

### Run Multiple Tests by Pattern

Use `|` to match multiple patterns:

```bash
cd agents && source ../.env && pnpm test src/testing/__tests__/sub-agent.integration.test.ts --testNamePattern="pattern one|pattern two"
```

### Capture Output to File

```bash
cd agents && source ../.env && pnpm test src/testing/__tests__/sub-agent.integration.test.ts 2>&1 | tee test-output.log
```

---

## Key Files

| File | Purpose |
|------|---------|
| `agents/src/runners/shared.ts` | Main runner logic for sub-agents |
| `agents/src/testing/__tests__/sub-agent.integration.test.ts` | The integration tests |
