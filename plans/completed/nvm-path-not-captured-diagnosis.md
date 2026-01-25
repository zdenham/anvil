# NVM PATH Not Captured in GUI App

## Problem

A user with Node.js installed via nvm reported "No such file or directory (os error 2)" when spawning agents. The app couldn't find the `node` binary despite it being available in their terminal.

## Why This Only Affects Some Users

Most users have Node.js installed via:
- **Homebrew** (`brew install node`) - installs to `/opt/homebrew/bin/node` which is in the default PATH
- **Official installer** - installs to `/usr/local/bin/node` which is in the default PATH
- **Version managers with proper setup** - some version managers (like Volta) modify `~/.zprofile` by default

This user had nvm installed, which by default adds its initialization to `~/.zshrc` only. The nvm install script (`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash`) detects the user's shell and appends to the appropriate rc file (`.zshrc` for zsh), not the profile file (`.zprofile`).

## Root Cause

The app captures the user's PATH by running `zsh -l -c 'echo $PATH'` (a login shell). However, nvm is typically initialized in `~/.zshrc` (interactive shell config), not `~/.zprofile` (login shell config).

**Shell config loading order:**
- Login shell (`zsh -l`): sources `~/.zprofile` only
- Interactive shell (`zsh`): sources `~/.zshrc`
- Interactive login shell (`zsh -l` in terminal): sources both

When users open a terminal, they get an interactive login shell that sources both files. But when the Tauri app runs `zsh -l -c 'echo $PATH'`, it only sources `~/.zprofile`, missing the nvm initialization in `~/.zshrc`.

## Diagnosis Steps

1. Check where node is installed:
   ```bash
   which node
   # Output: /Users/flint/.nvm/versions/node/v22.16.0/bin/node
   ```

2. Check what the login shell PATH contains:
   ```bash
   /bin/zsh -l -c 'echo $PATH'
   ```

3. Compare to the PATH captured by the app (visible in logs). The app's captured PATH was missing `/Users/flint/.nvm/versions/node/v22.16.0/bin`.

## Solution

Add nvm initialization to `~/.zprofile` so it runs in login shells:

```bash
cat >> ~/.zprofile << 'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
EOF
```

Then quit and reopen the app to re-capture the PATH.

## Applies To

This same issue affects any Node version manager that initializes in `.zshrc`:
- **nvm**: Add to `~/.zprofile`
- **fnm**: Add `eval "$(fnm env)"` to `~/.zprofile`
- **volta**: Usually works since it modifies PATH directly in `.zprofile`
- **asdf**: Add `. "$HOME/.asdf/asdf.sh"` to `~/.zprofile`

## Relevant Code

- `src-tauri/src/paths.rs:94` - Login shell command execution
- `src/lib/agent-service.ts:487` - Where `Command.create("node", ...)` spawns the agent

## Future Considerations

Could potentially:
1. Add `HOME` env var explicitly when spawning the shell command
2. Use `zsh -i -l -c` to source both configs (but slower and may have side effects)
3. Document this in user-facing setup/troubleshooting docs
