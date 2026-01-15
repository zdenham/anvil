# Phase 5: Benchmark Infrastructure (Future)

## Overview

Build benchmark infrastructure for systematically evaluating agent intelligence on standardized tasks. This enables tracking agent performance over time, comparing different agent configurations, and identifying regressions.

## Dependencies

- Phase 4 complete (mock LLM support recommended for deterministic benchmarks)
- Phase 2b (`AgentTestHarness`) for running agents in isolated environments

## Status

**Future** - Out of scope for v1. Planned for when systematic evaluation is needed.

## Architecture

```
agents/src/testing/benchmarks/
├── runner.ts           # Benchmark execution engine
├── scorer.ts           # Result scoring strategies
├── reporter.ts         # Generate reports from results
├── types.ts            # Shared type definitions
├── tasks/
│   ├── simple-edit/
│   │   ├── task.json   # Task definition
│   │   ├── expected/   # Expected outcomes
│   │   └── fixtures/   # Initial state (files to copy)
│   ├── multi-file-refactor/
│   └── bug-fix/
└── reports/
    └── 2024-01-15/     # Historical results by date
```

## Benchmark Task Format

### `task.json`

Each benchmark task is defined by a JSON file specifying the task parameters and scoring criteria.

```json
{
  "id": "simple-edit-001",
  "name": "Add TODO comment",
  "description": "Add a TODO comment to a function",
  "category": "simple-edit",
  "agent": "execution",
  "prompt": "Add a TODO comment to the main function in src/main.js noting that error handling is needed",
  "fixture": "minimal",
  "timeout": 30000,
  "scoring": {
    "type": "contains",
    "target": "src/main.js",
    "mustContain": ["TODO", "error handling"],
    "mustNotContain": ["FIXME"]
  },
  "tags": ["editing", "comments"],
  "difficulty": "easy"
}
```

### Task Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the task |
| `name` | string | Yes | Human-readable name |
| `description` | string | Yes | Detailed description of what the task tests |
| `category` | string | Yes | Task category for grouping |
| `agent` | string | Yes | Agent type to use (e.g., "execution", "research") |
| `prompt` | string | Yes | The prompt to send to the agent |
| `fixture` | string | Yes | Name of the fixture directory to use |
| `timeout` | number | Yes | Maximum time in milliseconds |
| `scoring` | object | Yes | Scoring configuration (see below) |
| `tags` | string[] | No | Tags for filtering benchmarks |
| `difficulty` | string | No | "easy", "medium", or "hard" |

### Scoring Types

| Type | Description | Configuration |
|------|-------------|---------------|
| `contains` | Check for specific strings in file | `target`, `mustContain[]`, `mustNotContain[]` |
| `file-diff` | Compare file contents against expected | `target`, `expectedPath` |
| `regex` | Match against regex patterns | `target`, `patterns[]` |
| `ast` | Parse and compare AST structure | `target`, `language`, `expectedAst` |
| `custom` | Run custom scoring function | `scorerPath`, `options` |

## Benchmark Runner

```typescript
// agents/src/testing/benchmarks/runner.ts

import { AgentTestHarness } from "../agent-harness";
import { scoreResult } from "./scorer";
import type { BenchmarkTask, BenchmarkResult, BenchmarkRunOptions } from "./types";

export interface BenchmarkResult {
  taskId: string;
  taskName: string;
  passed: boolean;
  score: number;          // 0.0 to 1.0
  duration: number;       // milliseconds
  attempts: number;
  output: AgentOutput;
  scoringDetails: {
    type: string;
    checks: Array<{ name: string; passed: boolean; message?: string }>;
  };
  error?: string;
}

export interface BenchmarkRunOptions {
  attempts?: number;      // Number of attempts for statistical significance
  mockLlm?: boolean;      // Use mock LLM for deterministic results
  parallel?: boolean;     // Run multiple tasks in parallel
  filter?: string;        // Filter tasks by name or tag
  passThreshold?: number; // Score threshold for passing (default: 0.8)
}

export async function runBenchmark(
  taskPath: string,
  options: BenchmarkRunOptions = {}
): Promise<BenchmarkResult> {
  const task = loadTask(taskPath);
  const passThreshold = options.passThreshold ?? 0.8;

  const harness = new AgentTestHarness({
    agent: task.agent,
    timeout: task.timeout,
  });

  try {
    const output = await harness.run({
      prompt: task.prompt,
      fixture: task.fixture,
    });

    const scoringResult = await scoreResult(task, output, harness);

    return {
      taskId: task.id,
      taskName: task.name,
      passed: scoringResult.score >= passThreshold,
      score: scoringResult.score,
      duration: output.duration,
      attempts: 1,
      output,
      scoringDetails: scoringResult.details,
    };
  } catch (error) {
    return {
      taskId: task.id,
      taskName: task.name,
      passed: false,
      score: 0,
      duration: 0,
      attempts: 1,
      output: null,
      scoringDetails: { type: "error", checks: [] },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    harness.cleanup();
  }
}

/**
 * Run multiple benchmarks with retry logic for statistical significance.
 */
export async function runBenchmarkSuite(
  taskPaths: string[],
  options: BenchmarkRunOptions = {}
): Promise<BenchmarkSuiteResult> {
  const results: BenchmarkResult[] = [];
  const attempts = options.attempts ?? 1;

  for (const taskPath of taskPaths) {
    const taskResults: BenchmarkResult[] = [];

    for (let i = 0; i < attempts; i++) {
      const result = await runBenchmark(taskPath, options);
      taskResults.push(result);
    }

    // Use best result if multiple attempts
    const best = taskResults.reduce((a, b) => (a.score > b.score ? a : b));
    best.attempts = attempts;
    results.push(best);
  }

  return {
    results,
    summary: summarizeResults(results),
    timestamp: new Date().toISOString(),
  };
}
```

## CLI Interface

```bash
# Run all benchmarks
pnpm --filter agents benchmark

# Run specific benchmark by name or category
pnpm --filter agents benchmark simple-edit
pnpm --filter agents benchmark --filter "category:bug-fix"

# Run with multiple attempts for statistical significance
pnpm --filter agents benchmark --attempts 5

# Run with mock LLM for deterministic results
pnpm --filter agents benchmark --mock

# Generate HTML report
pnpm --filter agents benchmark --report

# Compare against previous run
pnpm --filter agents benchmark --compare 2024-01-14

# Run in parallel (faster, but less stable results)
pnpm --filter agents benchmark --parallel
```

## Example Benchmark Tasks

### Simple Edit (Difficulty: Easy)
Tasks testing basic file editing capabilities:
- Add comment to file
- Rename variable within a function
- Add import statement
- Fix typo in string literal

### Multi-File Refactor (Difficulty: Medium)
Tasks requiring changes across multiple files:
- Extract function to new file and update imports
- Rename function across all call sites
- Move constant to shared config file
- Update type definition and all usages

### Bug Fix (Difficulty: Medium-Hard)
Tasks requiring understanding of code logic:
- Fix off-by-one error in loop
- Handle null/undefined case
- Fix async/await race condition
- Correct incorrect boolean logic

### Research (Difficulty: Varies)
Tasks testing code understanding without modification:
- Find all usages of a function
- Summarize code architecture
- Identify potential security issues
- Explain data flow through a system

## Metrics Tracked

| Metric | Description | Aggregation |
|--------|-------------|-------------|
| Pass rate | Percentage of tasks scoring above threshold | By category, overall |
| Avg score | Average scoring value (0.0-1.0) | By category, overall |
| Avg duration | Time to complete in milliseconds | By category, overall |
| Tool efficiency | Tools used vs. minimum needed | Per task |
| Token usage | Input/output tokens consumed | Per task, cumulative |
| Error rate | Percentage of tasks that errored | By category |
| Consistency | Variance across multiple attempts | Per task |

## Report Format

Reports are saved as JSON for programmatic access and HTML for viewing:

```
reports/2024-01-15/
├── results.json      # Raw results data
├── summary.json      # Aggregated metrics
├── report.html       # Human-readable report
└── comparison.json   # Diff from previous run (if --compare used)
```

## Implementation Notes

1. **Fixtures should be minimal** - Each benchmark task should include only the files needed to complete the task, keeping setup fast.

2. **Deterministic scoring preferred** - Use `contains` or `file-diff` over `ast` when possible for simpler debugging.

3. **Mock LLM for CI** - Use mock scripts in CI to avoid API costs and flakiness. Reserve real LLM tests for nightly runs.

4. **Version control tasks** - Task definitions should be version controlled so benchmark results remain comparable over time.

## Acceptance Criteria

- [ ] Task JSON format is documented and validated
- [ ] Benchmark runner executes tasks correctly
- [ ] All scoring strategies implemented (contains, file-diff, regex, ast, custom)
- [ ] Results are saved to timestamped directories
- [ ] CLI commands work for running and filtering benchmarks
- [ ] HTML report generated with pass/fail summary
- [ ] Comparison mode shows regression between runs

## Estimated Effort

High (~1-2 weeks)

- Task format and validation: 2-3 hours
- Benchmark runner: 4-6 hours
- Scoring strategies: 4-6 hours
- Reporter and comparison: 4-6 hours
- CLI integration: 2-3 hours
- Example benchmark tasks: 3-4 hours
- Documentation and testing: 2-3 hours
