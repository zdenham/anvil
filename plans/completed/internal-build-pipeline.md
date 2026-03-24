# Internal Build Pipeline

## Overview

Create a script that automates the internal distribution process:
1. Increment the app version
2. Build the application
3. Zip the `.app` bundle as `{version}.zip`
4. Upload the zip to Cloudflare R2 bucket
5. Update the version file for the installation script

## Current State

- **Version locations**: `package.json` and `src-tauri/tauri.conf.json` (both at `v0.0.1`)
- **Build output**: `src-tauri/target/release/bundle/macos/anvil.app`
- **Cloudflare bucket**: `anvil-builds` (public URL: `pub-484a71c5f2f240489aee02d684dbb550.r2.dev`)
- **Expected paths**:
  - `/anvil-builds/{version}.zip` - the app bundle
  - `/anvil-installation-scripts/version` - plain text version string
- **Credentials**: `CLOUDFLARE_USER_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `.env`

## Implementation

### File to Create

| File | Description |
|------|-------------|
| `scripts/internal-build.sh` | Main build pipeline script |

### Dependencies

The script requires the `wrangler` CLI for R2 uploads:
```bash
pnpm add -D wrangler
```

### Script: `scripts/internal-build.sh`

```bash
#!/bin/bash
set -e

# Usage: ./scripts/internal-build.sh [patch|minor|major]

BUMP_TYPE=${1:-patch}

# Load environment variables
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

# --- 1. Increment Version ---
echo "Incrementing version (${BUMP_TYPE})..."

# Read current version from package.json (strip 'v' prefix for calculation)
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: ${CURRENT_VERSION}"

# Strip 'v' prefix if present for version calculation
VERSION_NUM="${CURRENT_VERSION#v}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION_NUM"
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

# Update tauri.conf.json
node -e "
const fs = require('fs');
const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
conf.version = '${NEW_VERSION}';
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
"

echo "Version updated to ${NEW_VERSION}"

# --- 2. Build Application ---
echo "Building application..."
pnpm build

# --- 3. Zip the Bundle ---
APP_PATH="src-tauri/target/release/bundle/macos/anvil.app"
ZIP_NAME="${NEW_VERSION}.zip"
ZIP_PATH="src-tauri/target/release/bundle/macos/${ZIP_NAME}"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: App bundle not found at ${APP_PATH}"
  exit 1
fi

echo "Creating zip archive: ${ZIP_NAME}..."
cd src-tauri/target/release/bundle/macos
zip -r -q "${ZIP_NAME}" anvil.app
cd - > /dev/null

echo "Zip created: ${ZIP_PATH}"

# --- 4. Upload to Cloudflare R2 ---
echo "Uploading to Cloudflare R2..."

# Upload the zip to anvil-builds/
npx wrangler r2 object put "anvil-builds/anvil-builds/${ZIP_NAME}" \
  --file="${ZIP_PATH}" \
  --content-type="application/zip"

echo "Uploaded ${ZIP_NAME} to anvil-builds/"

# --- 5. Update Version File ---
echo "Updating version file..."

# Create temporary version file
VERSION_FILE=$(mktemp)
echo -n "${NEW_VERSION}" > "$VERSION_FILE"

# Upload version file
npx wrangler r2 object put "anvil-builds/anvil-installation-scripts/version" \
  --file="$VERSION_FILE" \
  --content-type="text/plain"

rm "$VERSION_FILE"

echo "Version file updated to ${NEW_VERSION}"

# --- Done ---
echo ""
echo "=========================================="
echo "  Build pipeline complete!"
echo "  Version: ${NEW_VERSION}"
echo "  Zip: ${ZIP_PATH}"
echo "  R2 path: anvil-builds/${ZIP_NAME}"
echo "=========================================="
echo ""
echo "Users can install with:"
echo "  curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/anvil-installation-scripts/distribute_internally.sh | bash"
```

### Usage

```bash
# Patch version bump (v0.0.1 -> v0.0.2)
./scripts/internal-build.sh

# Minor version bump (v0.0.1 -> v0.1.0)
./scripts/internal-build.sh minor

# Major version bump (v0.0.1 -> v1.0.0)
./scripts/internal-build.sh major
```

### Wrangler Configuration

The script uses wrangler CLI which reads credentials from environment variables in `.env`:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Implementation Steps

1. Install wrangler: `pnpm add -D wrangler`
2. Create the script at `scripts/internal-build.sh`
3. Make it executable: `chmod +x scripts/internal-build.sh`
4. Add npm script to `package.json`: `"release:internal": "./scripts/internal-build.sh"`
5. Test with a patch release

## Verification

After running the script:
1. Check version in `package.json` and `tauri.conf.json` match
2. Verify zip exists at `src-tauri/target/release/bundle/macos/{version}.zip`
3. Confirm R2 upload: `curl -I https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/anvil-builds/{version}.zip`
4. Confirm version file: `curl https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/anvil-installation-scripts/version`
5. Test installation script on a clean machine

## Considerations

### Version Sync
Both `package.json` and `tauri.conf.json` must stay in sync. The script updates both atomically.

### Rollback
If the build fails after version bump, manually revert the version changes or re-run with the previous version.

### Git Integration (Optional)
Consider adding git operations:
- Commit version bump: `git commit -am "Release ${NEW_VERSION}"`
- Tag release: `git tag v${NEW_VERSION}`
- Push: `git push && git push --tags`

This is left as optional since some teams prefer manual git operations for releases.

