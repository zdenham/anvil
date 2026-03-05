/**
 * Spike to verify that ts.transpileModule() works correctly and survives
 * the tsup bundle. Tests four cases: plain JS passthrough, TS type
 * stripping, async code with await, and invalid syntax error handling.
 *
 * Run: node agents/dist/ts-transpile-spike-runner.js
 */
import ts from "typescript";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

interface TestCase {
  name: string;
  code: string;
  expectError?: boolean;
}

const TEST_CASES: TestCase[] = [
  {
    name: "Plain JS passthrough",
    code: "const x = 1 + 1; return x;",
  },
  {
    name: "TS type annotations stripped",
    code: "const x: number = 1 + 1; return x;",
  },
  {
    name: "Async code with await",
    code: "const result = await Promise.resolve(42); return result;",
  },
  {
    name: "Invalid syntax error handling",
    code: "const x: number = <<<INVALID>>>; return x;",
    expectError: true,
  },
];

function transpile(code: string): ts.TranspileOutput {
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });
}

async function executeTranspiled(jsCode: string): Promise<unknown> {
  const fn = new AsyncFunction(jsCode);
  return fn();
}

async function runTest(testCase: TestCase, index: number): Promise<void> {
  console.log(`--- Test ${index + 1}: ${testCase.name} ---`);
  console.log(`Input:  ${testCase.code}`);

  try {
    const result = transpile(testCase.code);
    const output = result.outputText.trim();
    console.log(`Output: ${output}`);

    if (result.diagnostics && result.diagnostics.length > 0) {
      console.log(`Diagnostics: ${JSON.stringify(result.diagnostics)}`);
    }

    if (testCase.expectError) {
      // For the error case, still try to execute to see what happens
      try {
        const value = await executeTranspiled(output);
        console.log(`Exec:   returned ${JSON.stringify(value)} (unexpected success)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`Exec:   threw as expected -> ${msg}`);
      }
    } else {
      const value = await executeTranspiled(output);
      console.log(`Exec:   returned ${JSON.stringify(value)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (testCase.expectError) {
      console.log(`Error (expected): ${msg}`);
    } else {
      console.log(`ERROR (unexpected): ${msg}`);
    }
  }

  console.log("");
}

async function runSpike(): Promise<void> {
  console.log("=== ts.transpileModule() Spike ===\n");
  console.log(`TypeScript version: ${ts.version}`);
  console.log(`ts.ScriptTarget.ESNext = ${ts.ScriptTarget.ESNext}`);
  console.log(`ts.ModuleKind.ESNext = ${ts.ModuleKind.ESNext}\n`);

  for (let i = 0; i < TEST_CASES.length; i++) {
    await runTest(TEST_CASES[i], i);
  }

  console.log("=== Spike Complete ===");
}

runSpike().catch(console.error);
