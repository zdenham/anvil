#!/usr/bin/env bash
set -euo pipefail

# Start the WS backend
echo "Starting Rust WS server..."
cargo run &
SERVER_PID=$!

# Wait for port 9600 to be ready
echo "Waiting for WS server on :9600..."
for i in $(seq 1 30); do
  if nc -z localhost 9600 2>/dev/null; then
    echo "WS server ready."
    break
  fi
  if [ $i -eq 30 ]; then
    echo "ERROR: WS server failed to start within 30s"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# Run tests (pass through any args like --project=critical)
echo "Running E2E tests..."
pnpm playwright test "$@"
TEST_EXIT=$?

# Cleanup
kill $SERVER_PID 2>/dev/null || true
exit $TEST_EXIT
