import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { QuickActionExecutionContext } from '../../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A quick action event emitted via stdout JSON lines.
 */
export interface QuickActionEvent {
  event: string;
  payload: unknown;
}

/**
 * Options for running a quick action.
 */
export interface RunnerOptions {
  /** Path to the compiled action .js file */
  actionPath: string;
  /** Execution context passed to the action */
  context: QuickActionExecutionContext;
  /** Path to the .mort directory */
  mortDir: string;
  /** Override default timeout (ms). Default: 5000ms for tests */
  timeout?: number;
}

/**
 * Result of running a quick action.
 */
export interface RunnerResult {
  /** Process exit code */
  exitCode: number;
  /** Parsed JSON events from stdout */
  events: QuickActionEvent[];
  /** Any stderr output */
  stderr: string;
  /** Execution time in milliseconds */
  duration: number;
}

/**
 * Path to the compiled SDK runner.
 * This is the bundled runner.ts that executes actions.
 */
function getRunnerPath(): string {
  // The runner is built to ../../sdk-runner.mjs relative to core/sdk/
  return path.resolve(__dirname, '../../../../sdk-runner.mjs');
}

/**
 * Spawn the runner process and execute a quick action.
 * Returns parsed events and execution metadata.
 *
 * Note: The SDK runner may not exit immediately after completing an action
 * due to pending timers (e.g., the 30-second timeout). We detect completion
 * by watching for stdout to close, then give a grace period for clean exit.
 */
export async function runQuickAction(options: RunnerOptions): Promise<RunnerResult> {
  const {
    actionPath,
    context,
    mortDir,
    timeout = 5000,
  } = options;

  const runnerPath = getRunnerPath();
  const startTime = Date.now();

  return new Promise((resolve) => {
    const events: QuickActionEvent[] = [];
    let stderr = '';
    let stdoutBuffer = '';
    let resolved = false;
    let stdoutEnded = false;

    const proc = spawn('node', [
      runnerPath,
      '--action', actionPath,
      '--context', JSON.stringify(context),
      '--mort-dir', mortDir,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const doResolve = (exitCode: number, timedOut: boolean = false) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      clearTimeout(gracePeriodId);

      // If timed out, add error event
      if (timedOut) {
        events.push({
          event: 'error',
          payload: {
            message: `Action timed out after ${timeout / 1000} seconds`,
            isTimeout: true,
          },
        });
      }

      resolve({
        exitCode,
        events,
        stderr,
        duration: Date.now() - startTime,
      });
    };

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      // Parse complete JSON lines
      const lines = stdoutBuffer.split('\n');
      // Keep incomplete line in buffer
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed) as QuickActionEvent;
            events.push(parsed);
          } catch {
            // Not valid JSON, ignore
          }
        }
      }
    });

    proc.stdout.on('end', () => {
      stdoutEnded = true;
      // Parse any remaining stdout
      if (stdoutBuffer.trim()) {
        try {
          const parsed = JSON.parse(stdoutBuffer.trim()) as QuickActionEvent;
          events.push(parsed);
        } catch {
          // Ignore
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Hard timeout - kill process if it takes too long
    const timeoutId = setTimeout(() => {
      proc.kill('SIGKILL');
      doResolve(1, true);
    }, timeout);

    // Grace period after stdout ends - process should exit quickly
    // If not, we consider the action complete anyway
    let gracePeriodId: ReturnType<typeof setTimeout>;

    proc.on('close', (code, signal) => {
      // Check if we got an error event from the runner itself
      const hasError = events.some(e => e.event === 'error');
      const exitCode = hasError ? 1 : (code ?? (signal ? 1 : 0));
      doResolve(exitCode);
    });

    proc.on('error', (err) => {
      events.push({
        event: 'error',
        payload: {
          message: err.message,
          isTimeout: false,
        },
      });
      doResolve(1);
    });

    // Watch for stdout end - give process 100ms grace period to exit cleanly
    // This handles the case where runner has pending timers but action is done
    proc.stdout.on('end', () => {
      gracePeriodId = setTimeout(() => {
        if (!resolved && stdoutEnded) {
          // Process didn't exit but stdout closed - action is likely complete
          // Kill process and resolve with success (no error events)
          const hasError = events.some(e => e.event === 'error');
          proc.kill('SIGTERM');
          doResolve(hasError ? 1 : 0);
        }
      }, 100);
    });
  });
}

/**
 * Get the path to a built action in the template dist directory.
 * @param actionSlug - The action slug (e.g., 'archive', 'mark-read')
 */
export function getTemplateActionPath(actionSlug: string): string {
  // From __tests__/harness/ -> ../.. -> core/sdk -> template/dist/actions
  return path.resolve(__dirname, '../../template/dist/actions', `${actionSlug}.js`);
}
