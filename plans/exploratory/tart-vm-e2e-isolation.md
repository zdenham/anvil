# Plan: Tart VM for Isolated E2E Testing

## Goal

Create a fully isolated testing environment using Tart (macOS Virtualization.framework) so that E2E tests can run without interfering with the user's active session.

---

## Why Tart?

| Approach | Isolation | Complexity | CI-Ready |
|----------|-----------|------------|----------|
| CGEventPost to active session | None | Low | No |
| Separate user session | Partial | Medium | No |
| **Tart VM** | **Complete** | **Medium** | **Yes** |
| Dedicated hardware | Complete | High | Yes |

Tart provides:
- Native Apple Silicon virtualization (fast, no emulation)
- Complete display/keyboard/clipboard isolation
- Snapshot/restore for reproducible test states
- Works identically in local dev and CI

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Host Mac                                     │
│                                                                      │
│  ┌──────────────────────┐         ┌──────────────────────────────┐  │
│  │   User Session       │         │        Tart VM               │  │
│  │                      │         │     (mort-test-vm)           │  │
│  │  • VS Code           │         │                              │  │
│  │  • Browser           │   SSH   │  • Mortician.app             │  │
│  │  • Claude Code ──────────────────▶ • mort-test CLI            │  │
│  │                      │         │  • Own display/keyboard      │  │
│  │  (uninterrupted)     │         │  • Own clipboard             │  │
│  │                      │         │                              │  │
│  └──────────────────────┘         └──────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  mort-test-vm wrapper                                         │   │
│  │  • Ensures VM is running                                      │   │
│  │  • Syncs latest Mortician build                               │   │
│  │  • Runs tests via SSH                                         │   │
│  │  • Returns structured results                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Host Requirements

- Apple Silicon Mac (M1/M2/M3)
- macOS 13+ (Ventura or later)
- ~20GB free disk space per VM
- Homebrew installed

### One-Time Setup

```bash
# Install Tart
brew install cirruslabs/cli/tart

# Verify installation
tart --version
```

---

## Phase 1: Base VM Image

### 1.1 Create Base Image

Use Cirrus Labs' pre-built macOS images as a starting point:

```bash
# Clone the base Sonoma image (~15GB download)
tart clone ghcr.io/cirruslabs/macos-sonoma-base:latest mort-test-base

# Or for a minimal image (smaller, faster)
tart clone ghcr.io/cirruslabs/macos-sonoma-vanilla:latest mort-test-base
```

### 1.2 Initial VM Configuration

```bash
# Start the VM with GUI for initial setup
tart run mort-test-base

# Default credentials for Cirrus images:
# Username: admin
# Password: admin
```

### 1.3 Configure VM for Testing

Inside the VM (via GUI or SSH):

```bash
# Enable SSH for remote access
sudo systemsetup -setremotelogin on

# Disable screen saver and sleep
sudo pmset -a displaysleep 0
sudo pmset -a sleep 0
defaults write com.apple.screensaver idleTime 0

# Grant Accessibility permissions to Terminal (for CGEventPost)
# System Settings → Privacy & Security → Accessibility → Terminal.app

# Install Homebrew (if using vanilla image)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install node pnpm

# Create directory for Mortician builds
mkdir -p ~/Applications
```

### 1.4 Save as Base Snapshot

```bash
# Stop the VM first
# Then create a snapshot we can restore to
tart clone mort-test-base mort-test-clean
```

---

## Phase 2: Mortician Test Image

### 2.1 Create Test-Specific Image

```bash
# Clone from clean base
tart clone mort-test-clean mort-test-vm
```

### 2.2 Sync Script

Create a script to sync latest Mortician build to VM:

**File: `scripts/sync-to-vm.sh`**

```bash
#!/bin/bash
set -euo pipefail

VM_NAME="${1:-mort-test-vm}"
VM_IP=$(tart ip "$VM_NAME" 2>/dev/null || echo "")

if [ -z "$VM_IP" ]; then
    echo "VM '$VM_NAME' is not running. Starting..."
    tart run "$VM_NAME" --no-graphics &
    sleep 10
    VM_IP=$(tart ip "$VM_NAME")
fi

echo "VM IP: $VM_IP"

# Build Mortician if needed
if [ ! -f "src-tauri/target/release/bundle/macos/Mortician.app" ]; then
    echo "Building Mortician..."
    pnpm tauri build
fi

# Sync the app bundle
echo "Syncing Mortician.app to VM..."
rsync -avz --delete \
    "src-tauri/target/release/bundle/macos/Mortician.app" \
    "admin@$VM_IP:~/Applications/"

# Sync mort-test binary (once built)
if [ -f "src-tauri/target/release/mort-test" ]; then
    rsync -avz \
        "src-tauri/target/release/mort-test" \
        "admin@$VM_IP:~/bin/"
fi

echo "Sync complete!"
```

### 2.3 VM Startup Script

**File: `scripts/start-test-vm.sh`**

```bash
#!/bin/bash
set -euo pipefail

VM_NAME="${1:-mort-test-vm}"

# Check if VM is already running
if tart ip "$VM_NAME" &>/dev/null; then
    echo "VM '$VM_NAME' is already running at $(tart ip "$VM_NAME")"
    exit 0
fi

# Start VM in headless mode
echo "Starting VM '$VM_NAME' in headless mode..."
tart run "$VM_NAME" --no-graphics &

# Wait for VM to be accessible
echo "Waiting for VM to boot..."
for i in {1..60}; do
    if tart ip "$VM_NAME" &>/dev/null; then
        VM_IP=$(tart ip "$VM_NAME")
        echo "VM ready at $VM_IP"

        # Wait for SSH to be available
        for j in {1..30}; do
            if ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no "admin@$VM_IP" "echo ok" &>/dev/null; then
                echo "SSH ready!"
                exit 0
            fi
            sleep 1
        done
        echo "SSH not responding"
        exit 1
    fi
    sleep 1
done

echo "VM failed to start"
exit 1
```

---

## Phase 3: Test Runner Wrapper

### 3.1 Isolated Test Command

**File: `scripts/mort-test-isolated.sh`**

```bash
#!/bin/bash
set -euo pipefail

VM_NAME="mort-test-vm"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

# Ensure VM is running
./scripts/start-test-vm.sh "$VM_NAME"

VM_IP=$(tart ip "$VM_NAME")

# Ensure Mortician is running in VM
ssh $SSH_OPTS "admin@$VM_IP" bash <<'EOF'
    # Kill any existing instance
    pkill -f Mortician || true
    sleep 1

    # Start Mortician
    open ~/Applications/Mortician.app
    sleep 3

    # Verify it's running
    if ! pgrep -f Mortician > /dev/null; then
        echo "Failed to start Mortician"
        exit 1
    fi
    echo "Mortician is running"
EOF

# Run the test command
echo "Running: mort-test $*"
ssh $SSH_OPTS "admin@$VM_IP" "~/bin/mort-test $*"
```

### 3.2 Usage Examples

```bash
# Run a scenario
./scripts/mort-test-isolated.sh scenario spotlight-search

# Trigger a shortcut
./scripts/mort-test-isolated.sh trigger "Command+Space"

# Check panel visibility
./scripts/mort-test-isolated.sh check spotlight
```

---

## Phase 4: CI Integration

### 4.1 GitHub Actions (with M1 runner)

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  e2e:
    runs-on: macos-14  # M1 runner
    steps:
      - uses: actions/checkout@v4

      - name: Install Tart
        run: brew install cirruslabs/cli/tart

      - name: Pull VM Image
        run: |
          tart clone ghcr.io/your-org/mort-test-vm:latest mort-test-vm

      - name: Start VM
        run: |
          tart run mort-test-vm --no-graphics &
          sleep 30

      - name: Build Mortician
        run: pnpm tauri build

      - name: Sync to VM
        run: ./scripts/sync-to-vm.sh

      - name: Run E2E Tests
        run: |
          ./scripts/mort-test-isolated.sh scenario spotlight-search
          ./scripts/mort-test-isolated.sh scenario clipboard-paste
```

### 4.2 Cirrus CI (Native Tart Support)

```yaml
# .cirrus.yml
task:
  name: E2E Tests
  macos_instance:
    image: ghcr.io/cirruslabs/macos-sonoma-xcode:latest

  install_script:
    - brew install cirruslabs/cli/tart

  vm_cache:
    folder: ~/.tart
    fingerprint_script: echo "mort-test-vm-v1"
    populate_script: |
      tart clone ghcr.io/your-org/mort-test-vm:latest mort-test-vm

  test_script:
    - ./scripts/start-test-vm.sh
    - ./scripts/sync-to-vm.sh
    - ./scripts/mort-test-isolated.sh scenario spotlight-search
```

---

## Phase 5: VM Image Publishing

### 5.1 Build and Push Custom Image

```bash
# After configuring mort-test-vm with all dependencies
# Push to GitHub Container Registry

tart push mort-test-vm ghcr.io/your-org/mort-test-vm:latest
```

### 5.2 Versioning Strategy

```bash
# Tag images by Mortician version
tart push mort-test-vm ghcr.io/your-org/mort-test-vm:v0.1.0
tart push mort-test-vm ghcr.io/your-org/mort-test-vm:latest
```

---

## Directory Structure

```
mortician/
├── scripts/
│   ├── start-test-vm.sh      # Start/ensure VM running
│   ├── stop-test-vm.sh       # Stop VM
│   ├── sync-to-vm.sh         # Sync build to VM
│   ├── mort-test-isolated.sh # Run tests in VM
│   └── setup-vm.sh           # Initial VM configuration
├── .github/
│   └── workflows/
│       └── e2e.yml           # CI workflow
└── src-tauri/
    └── src/
        └── bin/
            └── mort-test/    # The test CLI (from e2e-testing-cli.md)
```

---

## Implementation Order

1. **Install Tart and create base VM** (~30 min)
   - `brew install cirruslabs/cli/tart`
   - Clone base image, configure SSH and accessibility

2. **Create sync and startup scripts** (~1 hour)
   - `sync-to-vm.sh`
   - `start-test-vm.sh`
   - `mort-test-isolated.sh`

3. **Build mort-test CLI** (from e2e-testing-cli.md plan)
   - Keyboard input module
   - Window observation module

4. **Test locally** (~1 hour)
   - Run scenarios in VM
   - Verify no interference with host

5. **CI setup** (~2 hours)
   - Push VM image to registry
   - Configure GitHub Actions

---

## Success Criteria

- [ ] VM starts in <30 seconds
- [ ] Tests run completely isolated from host session
- [ ] User can work normally while tests run
- [ ] Same tests work in CI
- [ ] VM image is cached/reusable
- [ ] Sync to VM completes in <10 seconds (after initial build)

---

## Limitations

- **Apple Silicon only**: Tart uses Virtualization.framework which only supports arm64 guests on arm64 hosts
- **Disk space**: Each VM image is ~15-20GB
- **First boot is slow**: ~30s to boot, but subsequent commands are fast
- **macOS license**: Running macOS VMs requires macOS host (Apple's license terms)

---

## References

- [Tart Documentation](https://tart.run/)
- [Cirrus Labs VM Images](https://github.com/cirruslabs/macos-image-templates)
- [Apple Virtualization.framework](https://developer.apple.com/documentation/virtualization)
- [GitHub Actions macOS Runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners)
