/**
 * Preload script to handle EPIPE errors gracefully.
 *
 * When piping output through commands that close early (e.g., `head -50`, `grep -m1`),
 * the stdout pipe breaks and Node.js throws EPIPE errors. By default, these unhandled
 * errors can crash the process before cleanup hooks run.
 *
 * This script must be loaded before vitest starts using NODE_OPTIONS="--require ./src/test/epipe-handler.cjs"
 *
 * Using .cjs extension because --require needs CommonJS modules (ESM uses --import).
 */

// Track if we've received EPIPE - once we have, all writes will fail
let epipeReceived = false;
let cleanupInProgress = false;

function killProcessGroup() {
  if (cleanupInProgress) return;
  cleanupInProgress = true;

  // Use pkill to find and kill all vitest worker processes
  // This is more reliable than process group signals because vitest workers
  // may be in different process groups
  const { execSync } = require('child_process');
  try {
    execSync('pkill -TERM -f "vitest.*forks"', { stdio: 'ignore' });
  } catch (err) {
    // pkill returns non-zero if no processes matched, which is fine
  }

  // Also try process group signal as a fallback
  try {
    process.kill(-process.pid, 'SIGTERM');
  } catch (err) {
    // Ignore errors
  }

  // Give processes a moment to handle SIGTERM, then force exit
  setTimeout(() => {
    process.exit(0);
  }, 200);
}

function handleEpipeError(err) {
  if (err && err.code === 'EPIPE') {
    epipeReceived = true;
    killProcessGroup();
  }
}

// Handle EPIPE on stdout
process.stdout.on('error', handleEpipeError);

// Handle EPIPE on stderr
process.stderr.on('error', handleEpipeError);

// Also handle the SIGPIPE signal directly (even though Node ignores it by default,
// adding a handler ensures our process doesn't get terminated)
process.on('SIGPIPE', () => {
  // Node.js ignores SIGPIPE by default, but having an explicit handler
  // ensures the process continues running until EPIPE is caught
});

// Patch console methods to handle EPIPE gracefully
// This catches cases where console.log/error throw before the error event fires
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = function(chunk, encoding, callback) {
  if (epipeReceived) {
    // Silently drop writes after EPIPE
    if (typeof callback === 'function') callback();
    return true;
  }
  try {
    return originalStdoutWrite(chunk, encoding, callback);
  } catch (err) {
    if (err && err.code === 'EPIPE') {
      handleEpipeError(err);
      return true;
    }
    throw err;
  }
};

process.stderr.write = function(chunk, encoding, callback) {
  if (epipeReceived) {
    if (typeof callback === 'function') callback();
    return true;
  }
  try {
    return originalStderrWrite(chunk, encoding, callback);
  } catch (err) {
    if (err && err.code === 'EPIPE') {
      handleEpipeError(err);
      return true;
    }
    throw err;
  }
};
