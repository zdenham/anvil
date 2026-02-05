#!/usr/bin/env node
import { parseArgs } from 'util';
import { z } from 'zod';
import { createSDK } from './runtime/index.js';

// 30-second timeout as per DD #25
const ACTION_TIMEOUT_MS = 30_000;

// Zod schema for CLI context validation (trust boundary)
const QuickActionExecutionContextSchema = z.object({
  contextType: z.enum(['thread', 'plan', 'empty']),
  threadId: z.string().optional(),
  planId: z.string().optional(),
  repository: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
  }).nullable(),
  worktree: z.object({
    id: z.string(),
    path: z.string(),
    branch: z.string().nullable(),
  }).nullable(),
  threadState: z.object({
    status: z.enum(['idle', 'running', 'completed', 'error', 'cancelled']),
    messageCount: z.number(),
    fileChanges: z.array(z.object({
      path: z.string(),
      operation: z.string(),
    })),
  }).optional(),
});

/**
 * Wraps action execution with a timeout using Promise.race().
 * If the action doesn't complete within ACTION_TIMEOUT_MS, the promise rejects.
 * Properly clears the timeout when the action completes to allow process exit.
 */
async function executeWithTimeout<T>(
  actionPromise: Promise<T>,
  timeoutMs: number = ACTION_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Action timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([actionPromise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}

const { values } = parseArgs({
  options: {
    action: { type: 'string' },    // Path to built JS file
    context: { type: 'string' },   // JSON context
    'mort-dir': { type: 'string' }, // Path to .mort directory
  },
});

async function main() {
  const actionPath = values.action!;
  const mortDir = values['mort-dir']!;

  // Validate context from CLI args (trust boundary - requires Zod validation)
  const context = QuickActionExecutionContextSchema.parse(JSON.parse(values.context!));

  // Create SDK with event emitter that writes to stdout
  const sdk = createSDK(
    mortDir,
    (event, payload) => {
      console.log(JSON.stringify({ event, payload }));
    }
  );

  // Import the pre-built action module
  const module = await import(actionPath);
  const actionDef = module.default;

  if (!actionDef || typeof actionDef.execute !== 'function') {
    throw new Error(`Action must export a default with an 'execute' function`);
  }

  // Execute action with 30-second timeout (DD #25)
  // If the action doesn't complete in time, Promise.race() rejects with timeout error
  await executeWithTimeout(actionDef.execute(context, sdk));
}

main().catch((err) => {
  // Emit error event with specific handling for timeout errors
  // Use console.log (stdout) so error events are captured alongside other events
  const isTimeout = err.message?.includes('timed out');
  console.log(JSON.stringify({
    event: 'error',
    payload: {
      message: err.message,
      isTimeout,
    }
  }));
  process.exit(1);
});
