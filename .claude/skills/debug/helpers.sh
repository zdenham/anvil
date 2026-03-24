#!/bin/bash
# Debug helper functions for Anvil development
# Source this file or copy individual functions as needed

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# DEV SERVER MANAGEMENT
# ============================================

# Start the dev server
anvil_dev_start() {
    echo -e "${GREEN}Starting Anvil dev server...${NC}"
    cd "$(git rev-parse --show-toplevel)" || return 1
    pnpm dev
}

# Start dev server headless (no main window)
anvil_dev_headless() {
    echo -e "${GREEN}Starting Anvil dev server (headless)...${NC}"
    cd "$(git rev-parse --show-toplevel)" || return 1
    pnpm dev:headless
}

# Kill all dev server processes
anvil_dev_kill() {
    echo -e "${YELLOW}Killing dev server processes...${NC}"
    pkill -f "tauri dev" 2>/dev/null && echo "  Killed tauri dev"
    pkill -f "vite" 2>/dev/null && echo "  Killed vite"
    pkill -f "cargo-watch" 2>/dev/null && echo "  Killed cargo-watch"
    pkill -f "concurrently" 2>/dev/null && echo "  Killed concurrently"
    echo -e "${GREEN}Done${NC}"
}

# Restart dev server
anvil_dev_restart() {
    anvil_dev_kill
    sleep 2
    anvil_dev_start
}

# ============================================
# LOG QUERIES
# ============================================

# View live logs
anvil_logs_live() {
    local root
    root="$(git rev-parse --show-toplevel)"
    tail -f "$root/logs/dev.log"
}

# Search logs for errors
anvil_logs_errors() {
    local root count
    root="$(git rev-parse --show-toplevel)"
    count="${1:-50}"
    grep -i "error" "$root/logs/dev.log" | tail -"$count"
}

# Search logs for warnings
anvil_logs_warnings() {
    local root count
    root="$(git rev-parse --show-toplevel)"
    count="${1:-50}"
    grep -i "warn" "$root/logs/dev.log" | tail -"$count"
}

# Search logs for a pattern with context
anvil_logs_search() {
    local root pattern context
    root="$(git rev-parse --show-toplevel)"
    pattern="$1"
    context="${2:-5}"

    if [ -z "$pattern" ]; then
        echo "Usage: anvil_logs_search <pattern> [context_lines]"
        return 1
    fi

    grep -A"$context" -B"$context" "$pattern" "$root/logs/dev.log" | tail -100
}

# Search logs by component
anvil_logs_component() {
    local root component count
    root="$(git rev-parse --show-toplevel)"
    component="$1"
    count="${2:-30}"

    if [ -z "$component" ]; then
        echo "Usage: anvil_logs_component <component> [count]"
        echo "Common components: agent_hub, hub::client, runner, output"
        return 1
    fi

    grep "$component" "$root/logs/dev.log" | tail -"$count"
}

# Query structured JSON logs
anvil_logs_json() {
    local level
    level="${1:-ERROR}"

    if [ -f ~/.anvil/logs/structured.jsonl ]; then
        cat ~/.anvil/logs/structured.jsonl | jq "select(.level == \"$level\")" | tail -20
    elif [ -f ~/.anvil-dev/logs/structured.jsonl ]; then
        cat ~/.anvil-dev/logs/structured.jsonl | jq "select(.level == \"$level\")" | tail -20
    else
        echo "No structured log file found"
        return 1
    fi
}

# Clear dev logs
anvil_logs_clear() {
    local root
    root="$(git rev-parse --show-toplevel)"
    > "$root/logs/dev.log"
    echo -e "${GREEN}Cleared dev.log${NC}"
}

# ============================================
# TEST RUNNERS
# ============================================

# Run all tests
anvil_test_all() {
    local root
    root="$(git rev-parse --show-toplevel)"
    cd "$root" && pnpm test
}

# Run UI tests
anvil_test_ui() {
    local root
    root="$(git rev-parse --show-toplevel)"
    cd "$root" && pnpm test:ui
}

# Run UI tests in watch mode
anvil_test_ui_watch() {
    local root
    root="$(git rev-parse --show-toplevel)"
    cd "$root" && pnpm test:ui:watch
}

# Run agent tests
anvil_test_agents() {
    local root
    root="$(git rev-parse --show-toplevel)"
    cd "$root" && pnpm test:agents
}

# Run agent harness tests
anvil_test_harness() {
    local root
    root="$(git rev-parse --show-toplevel)"
    cd "$root" && pnpm test:harness
}

# Run a specific test file
anvil_test_file() {
    local root file
    root="$(git rev-parse --show-toplevel)"
    file="$1"

    if [ -z "$file" ]; then
        echo "Usage: anvil_test_file <path/to/test.ts>"
        return 1
    fi

    cd "$root" && pnpm vitest run "$file"
}

# Run a specific test file in watch mode
anvil_test_watch() {
    local root file
    root="$(git rev-parse --show-toplevel)"
    file="$1"

    if [ -z "$file" ]; then
        echo "Usage: anvil_test_watch <path/to/test.ts>"
        return 1
    fi

    cd "$root" && pnpm vitest watch "$file"
}

# ============================================
# QUICK DIAGNOSTICS
# ============================================

# Show status of dev server processes
anvil_status() {
    echo -e "${BLUE}Dev Server Processes:${NC}"
    pgrep -fl "tauri dev" || echo "  No tauri dev process"
    pgrep -fl "vite" || echo "  No vite process"
    pgrep -fl "cargo-watch" || echo "  No cargo-watch process"

    echo ""
    echo -e "${BLUE}Recent Errors (last 5):${NC}"
    anvil_logs_errors 5 2>/dev/null || echo "  No log file found"
}

# Quick health check
anvil_health() {
    local root
    root="$(git rev-parse --show-toplevel)"

    echo -e "${BLUE}Running health checks...${NC}"

    echo -n "TypeScript: "
    if cd "$root" && pnpm typecheck > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAIL${NC}"
    fi

    echo -n "Rust: "
    if cd "$root/src-tauri" && cargo check > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAIL${NC}"
    fi

    echo -n "Unit Tests: "
    if cd "$root" && pnpm test:ui > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
    else
        echo -e "${RED}FAIL${NC}"
    fi
}

# Print help
anvil_debug_help() {
    echo "Anvil Debug Helpers"
    echo "=================="
    echo ""
    echo "Dev Server:"
    echo "  anvil_dev_start      - Start the dev server"
    echo "  anvil_dev_headless   - Start dev server without main window"
    echo "  anvil_dev_kill       - Kill all dev server processes"
    echo "  anvil_dev_restart    - Restart the dev server"
    echo ""
    echo "Logs:"
    echo "  anvil_logs_live              - Tail live logs"
    echo "  anvil_logs_errors [count]    - Show recent errors"
    echo "  anvil_logs_warnings [count]  - Show recent warnings"
    echo "  anvil_logs_search <pattern>  - Search logs with context"
    echo "  anvil_logs_component <name>  - Filter by component"
    echo "  anvil_logs_json [level]      - Query structured JSON logs"
    echo "  anvil_logs_clear             - Clear dev logs"
    echo ""
    echo "Tests:"
    echo "  anvil_test_all         - Run all tests"
    echo "  anvil_test_ui          - Run UI tests"
    echo "  anvil_test_ui_watch    - Run UI tests in watch mode"
    echo "  anvil_test_agents      - Run agent tests"
    echo "  anvil_test_harness     - Run harness E2E tests"
    echo "  anvil_test_file <path> - Run specific test file"
    echo "  anvil_test_watch <path>- Watch specific test file"
    echo ""
    echo "Diagnostics:"
    echo "  anvil_status           - Show dev server status"
    echo "  anvil_health           - Run health checks"
}
