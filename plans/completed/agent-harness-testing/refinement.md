# Agent Harness Testing Plan Refinements

This document summarizes all refinements made to the agent harness testing plan files by automated review agents.

---

## 00a-runner-types.md

- **Expanded the Overview section** to explain the purpose of the strategy pattern and how it enables a unified entry point for both task-based and simple agents
- **Added missing fields to interfaces** to align with existing code: `RunnerConfig` now includes `historyFile`, `parentTaskId`, and `appendedPrompt` from `runner.ts` Args; `OrchestrationContext` now includes `branchName`, `mergeBase`, and `threadPath` from `orchestrate()` output. Also added `AgentType` as a standalone type
- **Enhanced `cleanup()` signature** to accept `status` and `error` parameters, making the interface more explicit about how cleanup should handle success vs error cases
- **Added comprehensive JSDoc comments** to all interfaces and methods, explaining their purpose, parameters, and behavior for both strategy implementations
- **Added Implementation Notes section** with type alignment mappings showing how the new types relate to existing code (`runner.ts` Args and `orchestrate()` output), plus a code example for strategy selection logic

---

## 00b-runner-shared-extraction.md

- **Expanded the Overview section** to clarify the purpose (enabling the strategy pattern) and specify the exact output file path (`agents/src/runners/shared.ts`)
- **Updated the shared code analysis** with accurate percentages (~70% vs original ~60%), added specific line references to the actual source files, and clearly distinguished what stays strategy-specific (validation hooks, file change tracking, task metadata)
- **Replaced placeholder code with complete, working implementation** - the original had skeleton functions with comments like "Extract from current runner.ts"; the new version includes fully typed, production-ready code based on actual extraction from `runner.ts` and `simple-runner.ts`
- **Added `AgentLoopOptions` interface** to support strategy-specific behavior injection (file change callbacks, stop hooks, thread writers) which was missing from the original plan and is critical for the strategy pattern to work
- **Added Testing Strategy, Risks and Mitigations sections, and detailed effort breakdown** to make the plan more actionable and help identify potential issues before implementation

---

## 00c-task-runner-strategy.md

- **Expanded the Overview section** to explain what the strategy handles (orchestration logic, worktree allocation, task metadata management) rather than just listing agent types
- **Added detailed inline comments** to the code skeleton, transforming vague placeholders like "Return normalized config" into numbered step-by-step implementation guides with specific payloads and service calls
- **Added three new sections**: Arg Parsing Requirements (table of CLI arguments with required/optional status), Error Handling (specific error scenarios and recommended behavior), and Testing Strategy (unit and integration test breakdown)
- **Converted services list to a table format** with Purpose column explaining what each service does and where it stores data, and added the missing `RepositorySettingsService` import to the code
- **Added effort breakdown** to the Estimated Effort section, splitting the 3-4 hours into specific tasks (arg parsing, setup, cleanup, error handling, testing) for better planning

---

## 00d-simple-runner-strategy.md

- **Expanded the Overview section** to explicitly describe what "simple agents" are and what they lack (no task orchestration, worktree allocation, or git-based file tracking), providing better context for readers unfamiliar with the system
- **Added detailed CLI arguments section** with inline comments explaining each required argument, making it clear what inputs the strategy expects and their purpose
- **Restructured the Implementation Notes** into clearly separated subsections (Setup Sequence, Cleanup Sequence) with numbered steps and specific implementation details like which Node.js functions to use (`existsSync()`, `mkdirSync` with `{ recursive: true }`)
- **Added JSDoc comments to the metadata schema** and clarified the file location path format, making the schema self-documenting and easier to implement correctly
- **Added new sections for Error Handling and Testing Notes** to cover edge cases, error messages, and testing strategy - these were missing from the original plan and are important for a complete implementation spec

---

## 00e-unified-entry-point.md

- **Expanded the Overview section** to clearly explain what this phase accomplishes (consolidating all agent types into a unified runner) and its role as the final Phase 0 integration step
- **Fixed incomplete dependencies** by adding the missing `00a` and `00b` dependencies with specific exports referenced (e.g., `RunnerStrategy`, `RunnerConfig`, `runAgentLoop`, `emitLog`), making the dependency chain explicit
- **Improved the code example** with better error handling: added cleanup attempts in the error path, proper scoping of `strategy` and `context` variables for cleanup access, and more robust error message formatting using `instanceof Error` checks
- **Restructured the CLI Interface section** by separating task-based and simple agent documentation, adding explicit "Required arguments" lists for each agent type, and adding a new "Stdout Protocol" table documenting the JSON line message types
- **Added a new "Testing Notes" section** with specific scenarios to cover (happy path, error during setup/loop, signal handling, invalid arguments), providing clearer guidance for test implementation

---

## 00f-vitest-config.md

- **Updated Vitest version**: Changed from `^1.0.0` to `^3.0.0` to reflect the current stable release
- **Fixed path aliases**: Corrected the resolve aliases to match the actual tsconfig.json paths (`@/` maps to `../src/` and `@core/` maps to `../core/`, with trailing slashes for directory-style aliases)
- **Improved document structure**: Split "Files to Create/Modify" into separate "Files to Modify" and "Files to Create" sections for clarity, and added a note about merging into existing package.json rather than replacing it
- **Added Configuration Rationale table**: Replaced the informal Notes section with a structured table explaining why each configuration setting was chosen
- **Clarified acceptance criteria**: Made the test command verification more explicit by noting that `--passWithNoTests` is needed initially when no tests exist yet

---

## 00g-cleanup-old-runners.md

- **Expanded pre-deletion verification into structured subsections** - Reorganized the checklist into three numbered sections: verifying no remaining references, verifying the unified runner works, and verifying the event protocol is unchanged. Added a check for external references in JSON and shell files
- **Added explicit build step before verification commands** - The original plan had verification commands but did not explicitly require building the project first, which would be necessary for the commands to work
- **Added a "Verify Event Protocol" section** - Documented the stdout JSON message formats (log, event, state) that must remain unchanged for Tauri frontend compatibility
- **Added a "Rollback" section** - Provided explicit git commands and steps to recover if issues are discovered after deletion, which was missing from the original plan
- **Improved acceptance criteria and test coverage** - Added running the test suite (`pnpm --filter agents test`) to both the post-deletion verification and acceptance criteria, and reordered criteria to be more logical (check references first, then delete, then verify build/tests)

---

## 01a-test-types.md

- **Fixed type re-exports to match actual codebase**: Updated the imports to use the real type names from `@core/types/events.ts` (`AgentLogMessage`, `AgentEventMessage`, `AgentStateMessage`, `AgentOutput`) instead of proposing duplicate definitions that conflicted with existing code
- **Renamed `AgentOutput` to `AgentRunOutput`**: The original plan defined an `AgentOutput` interface that conflicted with the existing `AgentOutput` union type in `events.ts`. Renamed to `AgentRunOutput` to clearly distinguish aggregated test results from individual stdout messages
- **Added explicit unit suffix to duration field**: Changed `duration` to `durationMs` to follow codebase conventions (matching `durationApiMs` in `ResultMetrics`) and provide clarity about the unit
- **Added comprehensive JSDoc comments**: Every interface and field now has documentation explaining its purpose, which helps future implementers understand the design intent
- **Added Design Decisions section**: Explained the rationale behind key choices (re-exporting vs. redefining, naming conventions, type distinctions) to help reviewers and implementers understand the reasoning

---

## 01b-test-anvil-directory.md

- **Expanded the Overview section** to explain the purpose more clearly - added context about mirroring the `~/.anvil` layout and enabling integration tests without affecting real data
- **Added missing `description` field** to the `createTask` input and TaskMetadata output, aligning with the actual `TaskMetadata` interface in `core/types/tasks.ts`
- **Added `defaultBranch` option** to `TestRepository` interface, making it configurable instead of hardcoded to "main", with the hardcoded default now using this parameter
- **Replaced `console.log` with `logger`** in the cleanup method, following the project's logging guidelines from `docs/agents.md` which explicitly prohibits `console.log`
- **Added a Usage Example section** with a complete code sample showing how to use the service in tests with beforeEach/afterEach hooks, making the plan more actionable for implementers
- **Improved JSDoc comments** throughout, including better descriptions for `init()`, `createTask()`, and `cleanup()` methods with usage guidance
- **Made acceptance criteria more precise** by adding backticks for method/file names and explicitly noting "including all required fields" for schema matching

---

## 01c-test-repository.md

- **Expanded the Overview section** to explain the purpose more clearly, adding context about why real git repositories are needed for agent testing and what verification they enable
- **Fixed a security bug in the `commit()` method** by adding proper escaping for single quotes in commit messages (`message.replace(/'/g, "'\\''")`) to prevent shell injection issues
- **Added a conditional check before initial commit** to handle the edge case where `getFixtureFiles()` might return an empty array, preventing a git error when committing with no staged files
- **Improved documentation throughout** by enhancing JSDoc comments (e.g., adding `@throws` to `git()` method), adding descriptions to fixture template sections, noting the fluent API pattern in Key Features, and adding a cleanup reminder to the usage example
- **Expanded Acceptance Criteria** from 6 items to 10, making them more specific and testable (e.g., "verify with `git log`", explicit criteria for `git()` throwing on failure, separate criteria for each preservation mechanism)
- **Added a new "Integration with TestAnvilDirectory" section** with a complete code example showing how to use both services together for full orchestration testing, improving the plan's practical utility

---

## 01d-services-index.md

- **Expanded the Overview**: Clarified the purpose by explaining that this is a "barrel index file" that establishes a stable public API for the testing infrastructure, rather than just stating it exports services
- **Improved Dependencies section**: Added specific details about which types each dependency provides, making it clearer what is being re-exported
- **Enhanced the code example**: Added comments to the index file (grouping services vs types), and completely rewrote the usage example to be more comprehensive with proper `beforeEach`/`afterEach` hooks, cleanup ordering guidance, and realistic test assertions
- **Added Design Notes section**: Included a new section explaining the architectural rationale (barrel exports pattern, explicit type exports for tree-shaking, stable import paths, and service composability across different test layers)
- **Refined Acceptance Criteria**: Added a fourth criterion about circular dependency checking, and clarified that type exports should be verified with `import type` syntax

---

## 02a-runner-config.md

- **Expanded the Overview section** to explain the purpose more clearly: the interface abstracts CLI argument construction and enables test customization of agent spawning behavior
- **Added detailed JSDoc comments** to the `RunnerConfig` interface, including `@param` descriptions for each `buildArgs` parameter and `@default` annotation for `runnerPath`
- **Added a new "Design Decisions" section** documenting the rationale behind key choices: strategy pattern for flexibility, agent type awareness, immutable defaults for test isolation, and thread ID generation behavior
- **Added "Integration with AgentTestHarness" section** showing how this config is consumed by the harness class (from `02b-agent-harness.md`), providing cross-reference context and a concrete code snippet
- **Expanded acceptance criteria** from 3 to 6 items, adding specific checks for simple vs task-based agent argument construction, thread ID default behavior, and custom `buildArgs` override capability

---

## 02b-agent-harness.md

- **Fixed type name inconsistencies**: Changed `AgentOutput` to `AgentRunOutput`, `LogMessage` to `AgentLogMessage`, `EventMessage` to `AgentEventMessage`, and `StateMessage` to `AgentStateMessage` to match the canonical types defined in `01a-test-types.md`. Also changed `duration` to `durationMs` for consistency
- **Improved code structure and documentation**: Extracted the inline JSON parsing logic into a separate `parseOutputLine()` method for better readability and testability. Added comprehensive JSDoc comments to all public methods explaining their purpose, parameters, and return values. Added a class-level docstring explaining the harness purpose
- **Added missing functionality**: Added a `repoPath` getter alongside `tempDirPath` to provide access to the repository path for file system assertions in tests. Added handling for unknown message types in the parser
- **Enhanced documentation sections**: Added a new "Stdout Protocol" section explaining the expected JSON-line format. Added an "Error Handling" table documenting behavior for different failure scenarios. Expanded the usage example to show proper test lifecycle with beforeEach/afterEach and failure preservation
- **Clarified acceptance criteria**: Made the acceptance criteria more specific (e.g., "Correctly categorizes messages into separate arrays", "Uses correct types from `./types.ts`") to be more testable and actionable

---

## 02c-assertions.md

- **Fixed type naming consistency**: Changed `AgentOutput` to `AgentRunOutput` and `duration` to `durationMs` throughout the code to align with the type definitions in `01a-test-types.md`
- **Added negative assertion methods**: Introduced `hasNoEvent()`, `hasNoFileChanges()`, `didNotUseTools()`, `hasNoErrorLogs()`, and `failed()` to enable testing that certain behaviors did not occur
- **Improved error messages**: Enhanced all error messages to include more context (e.g., JSON payloads, log counts by level, event sequences) to aid debugging when tests fail
- **Added new section and methods**: Added a "Design Decisions" section explaining the rationale, a `getOutput()` method for escaping to custom assertions, and a private `countLogs()` helper for diagnostic output
- **Improved documentation and formatting**: Expanded the overview, added JSDoc example to the factory function, updated the assertion methods table with proper markdown alignment, and added a comprehensive "Negative assertions" usage example

---

## 02d-testing-index.md

- **Fixed type naming inconsistencies**: Changed exported types from the incorrect names (`AgentOutput`, `LogMessage`, `EventMessage`, `StateMessage`, `LogLevel`) to match the actual type definitions in `01a-test-types.md` (`AgentRunOutput`, `AgentLogMessage`, `AgentEventMessage`, `AgentStateMessage`, `StdoutMessage`)
- **Added missing dependency**: Included `02a-runner-config.md` in the Dependencies section with descriptive context for each dependency, since the index exports from the runner-config module
- **Expanded documentation**: Added a "Design Notes" section explaining the rationale behind the single import path pattern and type re-export strategy; added an "Import Paths Summary" table showing available import options for different use cases
- **Improved usage example**: Added explicit type annotation showing `AgentRunOutput`, added explanatory comment for the cleanup pattern, and included a second test case demonstrating error handling assertions
- **Enhanced acceptance criteria**: Added two new criteria covering circular dependency prevention and IDE autocomplete functionality

---

## 03a-harness-self-test.md

- **Added proper cleanup handling with `afterEach` hooks**: The original tests called `cleanup()` inline within tests, which would leak resources if tests failed. Added `let` declarations for test subjects at describe scope with `afterEach` hooks to ensure cleanup happens even on test failures
- **Added "Rationale" section explaining why self-verification tests matter**: This helps developers understand the purpose of testing the test framework itself - building trust in the infrastructure and providing fast feedback loops
- **Expanded test coverage**: Added explicit cleanup verification tests for both `TestAnvilDirectory` and `TestRepository`, a new fluent chaining test for assertions, and a timeout handling test for live agent runs
- **Improved documentation structure**: Added a table-based test categories section, included the package.json script definition that was missing, enhanced bash examples with a grep command for running only live tests, and added a Notes section with implementation guidance
- **Made assertion tests more explicit**: Added regex matchers to verify specific error messages are thrown (e.g., `/Expected event "nonexistent:event" not found/`), ensuring tests validate both behavior and error quality

---

## 03b-agent-acceptance-tests.md

- **Added a Prerequisites section** that explicitly documents the API key requirement, test skipping behavior, and expected API costs per run (~$0.10-0.50). This helps developers understand what they need before running tests
- **Added descriptive headers for each test file** explaining what category of behavior each file tests (event emission, state transitions, tool usage), making the purpose clearer at a glance
- **Added a "Notes on Test Reliability" section** addressing the inherent non-determinism of LLM-based tests, explaining the design philosophy (unambiguous prompts, behavior patterns over exact output) and how to handle flakiness
- **Improved the Environment Variables table** by adding a "Required" column and expanding descriptions to be more specific about what each variable does
- **Expanded the Acceptance Criteria and Estimated Effort sections** with more specific checkpoints (including all three files, debug output verification) and a breakdown of where time is expected to be spent (implementation vs. prompt tuning)

---

## 04-mock-llm.md

- **Added architecture diagram and expanded overview**: Included a visual diagram showing how mock detection works at the runner level, and clarified that the mock system tests agent logic, tool orchestration, and state management independently of LLM behavior
- **Fixed tool input parameter names**: Corrected `path` to `file_path` in MockScripts helpers (e.g., `readAndRespond`, `writeFile`) to match the actual SDK tool interfaces, and added proper `old_string`/`new_string` parameters for Edit operations
- **Added missing functionality**: Included `cleanupMockScript()` function for removing temp files, `MockToolCall` interface with optional ID field, error simulation support via `error` field in `MockResponse`, and helper methods on `MockClaudeClient` (`isExhausted()`, `remainingResponses()`) for test assertions
- **Enhanced code robustness**: Added proper logging using the project's logger, included SDK response type definitions (`SDKContentBlock`, `MockSDKResponse`), improved error messages to include script path for debugging, and added a `readEditRespond` helper for multi-step workflows
- **Improved documentation structure**: Added a decision table for when to use mock vs real LLM, expanded the usage example with multiple test cases (deterministic response, tool calls, error handling), included implementation considerations for SDK integration, added an "Open Questions" section for unresolved design decisions, and broke down the effort estimate by component

---

## 05-benchmarks.md

- **Added explicit dependency on Phase 2b** (`AgentTestHarness`) which is required for running agents in isolated environments, and expanded the overview to explain the business value (tracking performance, comparing configurations, identifying regressions)
- **Added comprehensive Task Fields documentation** with a table specifying each field's type, whether it's required, and its purpose. Added new fields (`category`, `tags`, `difficulty`) and enhanced the scoring configuration with `mustNotContain` for negative checks
- **Improved code examples with error handling and proper typing** - Added try/catch/finally blocks, structured `scoringDetails` type, configurable `passThreshold`, and a new `runBenchmarkSuite` function for running multiple benchmarks with retry logic
- **Expanded CLI interface and metrics** - Added commands for filtering by category, mock LLM mode, comparison mode, and parallel execution. Added new metrics (Error rate, Consistency) with aggregation levels specified. Added Report Format section documenting the output file structure
- **Added Implementation Notes section** with practical guidance on fixture size, scoring strategy selection, CI usage with mock LLM, and version control practices. Broke down the estimated effort into specific sub-tasks for better planning

---

## README.md

- **Added Overview section**: Introduced context explaining what the Agent Harness Testing Framework is and why it exists, including a bullet-point summary of its four main capabilities (isolated test environments, subprocess management, assertion helpers, unified runner)
- **Fixed Phase 2 dependency diagram**: Corrected the misleading diagram to show that `02a` and `02c` both flow into `02b`, and added a clarifying note that `02c` depends on `01a` (not `02a`). This matches the actual dependency structure in the sub-plan files
- **Corrected dependency references**: Fixed the Optional/Future table where `05-benchmarks.md` incorrectly listed "Phase 4" as a dependency (changed to "Phase 3"), and expanded table descriptions throughout for clarity (e.g., "RunnerStrategy interface" instead of just "RunnerStrategy interface")
- **Improved parallel execution documentation**: Restructured the "Execution Order Summary" section into "Phase Dependencies" and "Parallel Execution Opportunities" with clearer explanations and added a "Notes" column to the parallel tasks table explaining why each parallel grouping works
- **Rewrote Getting Started section**: Replaced the terse numbered list with more actionable, explanatory steps that explicitly reference phases and provide clearer guidance on the workflow

---

## Summary Statistics

- **Total files refined**: 20
- **Common improvements across files**:
  - Expanded overview/purpose sections for clarity
  - Added JSDoc comments and documentation
  - Fixed type naming inconsistencies (especially `AgentRunOutput` vs `AgentOutput`)
  - Added error handling sections
  - Enhanced acceptance criteria to be more specific and testable
  - Added usage examples with proper cleanup patterns (`beforeEach`/`afterEach`)
  - Added design decisions/rationale sections
  - Fixed code to match actual codebase conventions
