# macOS Code Signing for Internal Distribution

> **Status:** COMPLETED
> **Created:** 2026-01-24

## Overview

This plan adds code signing and notarization to the existing `internal-build.sh` workflow. The current pipeline already handles version bumping, building, zipping, and uploading to Cloudflare R2. We just need to integrate signing into this flow.

**Current workflow (`scripts/internal-build.sh`):**
```
pnpm release:internal [patch|minor|major]
    ↓
Verify Cloudflare auth → Bump version → pnpm build → Zip Anvil.app
    ↓
Upload to R2: anvil-builds/{VERSION}.zip
    ↓
Update version file → Users install via curl | bash
```

**Updated workflow (this plan):**
```
pnpm release:internal [patch|minor|major]
    ↓
Verify Cloudflare auth → Load signing credentials → Bump version
    ↓
pnpm tauri build (with APPLE_* env vars for auto-signing + notarization)
    ↓
Verify signature → Zip Anvil.app → Upload to R2
    ↓
Update version file → Users install via curl | bash (no quarantine removal needed)
```

### Goals
- Sign and notarize macOS builds within the existing `internal-build.sh` script
- Keep R2 upload and `curl | bash` distribution unchanged
- Ensure permissions persist across updates (no re-prompting)
- Remove the need for `xattr -d com.apple.quarantine` in the install script

### Key Requirements for Permission Persistence
For macOS to preserve user-granted permissions across app updates:
1. **Same bundle identifier** - Must remain `com.anvil.app` across all versions
2. **Same code signing identity** - Must use the same Team ID / Developer ID certificate

---

## Part 1: One-Time Setup

### 1.1 Create Entitlements File

Create `src-tauri/entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Required for JIT compilation in WebView -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <!-- Required for JavaScript execution in WebView -->
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- Required for loading dynamic libraries -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

### 1.2 Update tauri.conf.json

Add the entitlements reference to the existing `bundle` section:

```json
{
  "bundle": {
    "macOS": {
      "minimumSystemVersion": "10.15",
      "entitlements": "entitlements.plist"
    }
  }
}
```

### 1.3 Create Signing Credentials File

Create `~/.anvil/signing.env` with your Apple Developer credentials:

```bash
# macOS Code Signing Configuration
# Get these from your Apple Developer account

export APPLE_ID="your-email@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # App-specific password (not your Apple ID password)
export APPLE_TEAM_ID="ABC123XYZ0"            # 10-character team ID
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (ABC123XYZ0)"
```

**To get an app-specific password:**
1. Go to https://appleid.apple.com/account/manage
2. Sign in → Security → App-Specific Passwords → Generate

**To find your Team ID:**
1. Go to https://developer.apple.com/account
2. Membership → Team ID

---

## Part 2: Update internal-build.sh

Modify `scripts/internal-build.sh` to add signing. Changes are minimal:

### 2.1 Add Signing Credential Loading (after Cloudflare auth check)

```bash
# --- Preflight Check: Load Signing Credentials ---
echo "Loading signing credentials..."
if [ -f "$HOME/.anvil/signing.env" ]; then
  source "$HOME/.anvil/signing.env"
  echo "Signing credentials loaded."
else
  echo "Warning: No signing config at ~/.anvil/signing.env"
  echo "Build will proceed unsigned (Gatekeeper will block)."
  read -p "Continue anyway? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Validate signing variables if present
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  MISSING_VARS=()
  [ -z "${APPLE_ID:-}" ] && MISSING_VARS+=("APPLE_ID")
  [ -z "${APPLE_PASSWORD:-}" ] && MISSING_VARS+=("APPLE_PASSWORD")
  [ -z "${APPLE_TEAM_ID:-}" ] && MISSING_VARS+=("APPLE_TEAM_ID")

  if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "Error: Missing signing variables: ${MISSING_VARS[*]}"
    exit 1
  fi

  echo "Will sign with: ${APPLE_SIGNING_IDENTITY}"
fi
```

### 2.2 Export Signing Variables Before Build

Replace the build step:

```bash
# --- 2. Build Application ---
echo "Building application..."

# Export signing variables so Tauri picks them up
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
export APPLE_ID="${APPLE_ID:-}"
export APPLE_PASSWORD="${APPLE_PASSWORD:-}"
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

pnpm build
```

### 2.3 Add Signature Verification (after build, before zip)

```bash
# --- 2.5 Verify Signature ---
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "Verifying code signature..."
  if codesign -dv --verbose=2 "$APP_PATH" 2>&1 | grep -q "Authority=Developer ID"; then
    echo "Code signature verified."

    echo "Checking Gatekeeper status..."
    if spctl -a -t exec -vv "$APP_PATH" 2>&1 | grep -q "accepted"; then
      echo "App passes Gatekeeper - notarization successful!"
    else
      echo "Warning: App may not pass Gatekeeper. Check notarization."
    fi
  else
    echo "Warning: Code signature verification failed."
  fi
fi
```

### 2.4 Full Updated Script

Here's the complete updated `scripts/internal-build.sh`:

```bash
#!/bin/bash
set -e

# Usage: ./scripts/internal-build.sh [patch|minor|major|--no-bump]

# Prevent DMG from opening after build
export CI=true

BUMP_TYPE=${1:-patch}
SKIP_BUMP=false

if [ "$BUMP_TYPE" = "--no-bump" ]; then
  SKIP_BUMP=true
fi

# Load environment variables (Cloudflare credentials)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# --- Preflight Check: Verify Cloudflare Auth ---
echo "Verifying Cloudflare authentication..."
if ! npx wrangler r2 bucket list &>/dev/null; then
  echo "Error: Cloudflare authentication failed."
  echo "Please check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env"
  exit 1
fi
echo "Cloudflare auth verified."

# --- Preflight Check: Load Signing Credentials ---
echo "Loading signing credentials..."
if [ -f "$HOME/.anvil/signing.env" ]; then
  source "$HOME/.anvil/signing.env"
  echo "Signing credentials loaded."
else
  echo "Warning: No signing config at ~/.anvil/signing.env"
  echo "Build will proceed unsigned (Gatekeeper will block)."
  read -p "Continue anyway? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Validate signing variables if present
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  MISSING_VARS=()
  [ -z "${APPLE_ID:-}" ] && MISSING_VARS+=("APPLE_ID")
  [ -z "${APPLE_PASSWORD:-}" ] && MISSING_VARS+=("APPLE_PASSWORD")
  [ -z "${APPLE_TEAM_ID:-}" ] && MISSING_VARS+=("APPLE_TEAM_ID")

  if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "Error: Missing signing variables: ${MISSING_VARS[*]}"
    exit 1
  fi

  echo "Will sign with: ${APPLE_SIGNING_IDENTITY}"
fi

# --- 1. Version ---
# Read current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: ${CURRENT_VERSION}"

# Strip 'v' prefix if present for version calculation
VERSION_NUM="${CURRENT_VERSION#v}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION_NUM"

if [ "$SKIP_BUMP" = true ]; then
  echo "Skipping version bump (--no-bump)"
  NEW_VERSION="${CURRENT_VERSION}"
  # Ensure version has 'v' prefix
  if [[ ! "$NEW_VERSION" =~ ^v ]]; then
    NEW_VERSION="v${NEW_VERSION}"
  fi
else
  echo "Incrementing version (${BUMP_TYPE})..."
  case $BUMP_TYPE in
    major)
      MAJOR=$((MAJOR + 1))
      MINOR=0
      PATCH=0
      ;;
    minor)
      MINOR=$((MINOR + 1))
      PATCH=0
      ;;
    patch)
      PATCH=$((PATCH + 1))
      ;;
    *)
      echo "Invalid bump type: ${BUMP_TYPE}. Use major, minor, or patch."
      exit 1
      ;;
  esac

  NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}"
  echo "New version: ${NEW_VERSION}"

  # Update package.json
  node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

  # Update tauri.conf.json (semver without 'v' prefix)
  SEMVER_VERSION="${MAJOR}.${MINOR}.${PATCH}"
  node -e "
  const fs = require('fs');
  const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  conf.version = '${SEMVER_VERSION}';
  fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
  "

  # Update Cargo.toml (semver without 'v' prefix)
  sed -i '' "s/^version = \".*\"/version = \"${SEMVER_VERSION}\"/" src-tauri/Cargo.toml

  echo "Version updated to ${NEW_VERSION}"
fi

# --- 2. Build Application ---
echo "Building application..."

# Export signing variables so Tauri picks them up for automatic signing + notarization
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
export APPLE_ID="${APPLE_ID:-}"
export APPLE_PASSWORD="${APPLE_PASSWORD:-}"
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

pnpm build

# --- 3. Locate and Verify App Bundle ---
APP_PATH="src-tauri/target/release/bundle/macos/Anvil.app"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: App bundle not found at ${APP_PATH}"
  exit 1
fi

# Verify signature if signing was enabled
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo ""
  echo "Verifying code signature..."
  if codesign -dv --verbose=2 "$APP_PATH" 2>&1 | grep -q "Authority=Developer ID"; then
    echo "✓ Code signature verified."

    echo "Checking Gatekeeper status..."
    if spctl -a -t exec -vv "$APP_PATH" 2>&1 | grep -q "accepted"; then
      echo "✓ App passes Gatekeeper - notarization successful!"
    else
      echo "⚠ Warning: App may not pass Gatekeeper. Check notarization status."
      echo "  You can check with: xcrun notarytool history --apple-id \$APPLE_ID --team-id \$APPLE_TEAM_ID"
    fi
  else
    echo "⚠ Warning: Code signature verification failed."
    echo "  The app may be blocked by Gatekeeper."
  fi
  echo ""
fi

# --- 4. Zip the Bundle ---
ZIP_NAME="${NEW_VERSION}.zip"
ZIP_PATH="src-tauri/target/release/bundle/macos/${ZIP_NAME}"

echo "Creating zip archive: ${ZIP_NAME}..."
cd src-tauri/target/release/bundle/macos
zip -r -q "${ZIP_NAME}" Anvil.app
cd - > /dev/null

echo "Zip created: ${ZIP_PATH}"

# --- 5. Upload to Cloudflare R2 ---
echo "Uploading to Cloudflare R2..."

# Upload the zip to anvil-builds/
npx wrangler r2 object put "anvil-builds/anvil-builds/${ZIP_NAME}" \
  --file="${ZIP_PATH}" \
  --content-type="application/zip" \
  --remote

echo "Uploaded ${ZIP_NAME} to anvil-builds/"

# --- 6. Update Version File ---
echo "Updating version file..."

# Create temporary version file
VERSION_FILE=$(mktemp)
echo -n "${NEW_VERSION}" > "$VERSION_FILE"

# Upload version file
npx wrangler r2 object put "anvil-builds/anvil-installation-scripts/version" \
  --file="$VERSION_FILE" \
  --content-type="text/plain" \
  --remote

rm "$VERSION_FILE"

echo "Version file updated to ${NEW_VERSION}"

# --- Done ---
echo ""
echo "=========================================="
echo "  Build pipeline complete!"
echo "  Version: ${NEW_VERSION}"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
echo "  Signed:  Yes (notarized)"
else
echo "  Signed:  No (unsigned build)"
fi
echo "  Zip: ${ZIP_PATH}"
echo "  R2 path: anvil-builds/${ZIP_NAME}"
echo "=========================================="
echo ""
echo "Users can install with:"
echo "  curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/anvil-installation-scripts/distribute_internally.sh | bash"
```

---

## Part 3: Update Installation Script

Once apps are properly signed and notarized, the `xattr -d com.apple.quarantine` command is no longer needed and should be removed. Update `scripts/installation/distribute_internally.sh`:

**Remove these lines:**
```bash
echo "Removing quarantine..."
xattr -d com.apple.quarantine ~/Downloads/Anvil.app
```

The signed + notarized app will pass Gatekeeper automatically—no quarantine removal needed.

**Updated `scripts/installation/distribute_internally.sh`:**

```bash
cat << 'EOF'

      ▄▀▀▀▄
     █ ◠◡◠ █
      ▀▄▄▄▀

  anvil inbound...

EOF

VERSION=$(curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/anvil-installation-scripts/version)

echo "Installing Anvil ${VERSION}..."

echo "Quitting existing Anvil..."
killall anvil 2>/dev/null || true

echo "Cleaning up old files..."
rm -rf ~/Downloads/Anvil.zip ~/Downloads/Anvil.app /Applications/Anvil.app

echo "Downloading Anvil ${VERSION}..."
curl -fL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/anvil-builds/${VERSION}.zip -o ~/Downloads/Anvil.zip

if [ ! -f ~/Downloads/Anvil.zip ]; then
    echo "Error: Failed to download Anvil ${VERSION}. Build may not exist."
    exit 1
fi

echo "Extracting..."
unzip -o -q ~/Downloads/Anvil.zip -d ~/Downloads/ -x "__MACOSX/*"

echo "Moving to Applications..."
mv ~/Downloads/Anvil.app /Applications/

echo "Opening Anvil..."
open /Applications/Anvil.app

echo "Done!"
```

**Note:** After deploying this updated install script to R2, all future installations will use the clean flow without quarantine removal. Users installing signed builds will have a seamless Gatekeeper experience.

---

## Part 4: Verification

After running `pnpm release:internal`, verify the signature:

```bash
# Check code signature details
codesign -dv --verbose=4 src-tauri/target/release/bundle/macos/Anvil.app

# Verify Gatekeeper approval (should show "accepted" + "Notarized Developer ID")
spctl -a -t exec -vv src-tauri/target/release/bundle/macos/Anvil.app
```

Expected output for a properly signed and notarized app:
```
src-tauri/target/release/bundle/macos/Anvil.app: accepted
source=Notarized Developer ID
```

---

## Part 5: Troubleshooting

### "App is damaged and can't be opened"
- Ensure all `APPLE_*` variables are in `~/.anvil/signing.env`
- Verify certificate is valid: `security find-identity -v -p codesigning`
- Check notarization succeeded in the build output

### Notarization fails
- Verify `APPLE_ID` is your Apple Developer email
- Ensure `APPLE_PASSWORD` is an **app-specific password** (not your Apple ID password)
- Check entitlements.plist exists at `src-tauri/entitlements.plist`
- Check notarization history: `xcrun notarytool history --apple-id $APPLE_ID --team-id $APPLE_TEAM_ID`

### Permissions re-prompted after update
- Verify bundle identifier is `com.anvil.app` in `tauri.conf.json`
- Verify you're signing with the **same Team ID** every time

### Build works but signature fails
- Tauri auto-signs when `APPLE_SIGNING_IDENTITY` is set
- Tauri auto-notarizes when `APPLE_ID` + `APPLE_PASSWORD` are also set
- If only signing (no notarization), users will see "unidentified developer" warning

---

## Environment Variables Reference

| Variable | Source | Description |
|----------|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | `.env` | Cloudflare API token for R2 uploads |
| `CLOUDFLARE_ACCOUNT_ID` | `.env` | Cloudflare account ID |
| `APPLE_SIGNING_IDENTITY` | `~/.anvil/signing.env` | Full signing identity (e.g., `Developer ID Application: Name (TEAMID)`) |
| `APPLE_ID` | `~/.anvil/signing.env` | Apple ID email for notarization |
| `APPLE_PASSWORD` | `~/.anvil/signing.env` | App-specific password for notarization |
| `APPLE_TEAM_ID` | `~/.anvil/signing.env` | 10-character team ID |

---

## Summary

This plan integrates code signing into the existing workflow with minimal changes:

1. **One-time setup:** Create `entitlements.plist`, update `tauri.conf.json`, create `~/.anvil/signing.env`
2. **Modified `internal-build.sh`:** Load signing credentials → export to Tauri → verify after build
3. **Same R2 upload flow:** Zip and upload remain unchanged
4. **Same install flow:** `curl | bash` still works, but now without quarantine removal

**What changes for users:**
- No more "unidentified developer" warnings
- No more re-accepting permissions after updates
- Cleaner first-launch experience

**What stays the same:**
- `pnpm release:internal [patch|minor|major]` command
- R2 bucket structure (`anvil-builds/{VERSION}.zip`)
- Installation URL (`curl -sL ... | bash`)
