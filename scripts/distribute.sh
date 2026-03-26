#!/bin/bash
set -e

# Usage: ./scripts/distribute.sh [patch|minor|major|--no-bump]

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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIGNING_ENV="$REPO_ROOT/secrets/signing.env"

echo "Loading signing credentials..."
if [ -f "$SIGNING_ENV" ]; then
  source "$SIGNING_ENV"
  echo "Signing credentials loaded."
else
  echo "Warning: No signing config at secrets/signing.env"
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

# --- 1b. Commit & Tag Release ---
echo "Committing all changes as ${NEW_VERSION}..."
git add -A
git commit -m "${NEW_VERSION}" || echo "Nothing to commit"
git tag -f "${NEW_VERSION}"
echo "Tagged ${NEW_VERSION}"

# --- 2. Sign Third-Party Binaries ---
# Tauri only signs its own binaries. We need to sign any native binaries
# from node_modules that get bundled as resources.
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "Signing third-party native binaries..."

  AGENTS_DIR="$REPO_ROOT/agents/node_modules/@anthropic-ai"
  SIDECAR_DIR="$REPO_ROOT/sidecar/node_modules/node-pty"

  sign_mach_o_binaries() {
    local search_dir="$1"
    local label="$2"
    if [ ! -d "$search_dir" ]; then
      echo "Warning: $label directory not found at $search_dir"
      return
    fi
    find -L "$search_dir" -type f \( -name "*.node" -o -name "rg" -o -name "spawn-helper" \) | while read -r binary; do
      if file "$binary" | grep -q "Mach-O"; then
        REAL_BINARY=$(realpath "$binary")
        echo "  Signing: $REAL_BINARY"
        codesign --force --options runtime --timestamp \
          --sign "$APPLE_SIGNING_IDENTITY" \
          --entitlements "$REPO_ROOT/src-tauri/entitlements.plist" \
          "$REAL_BINARY"
      fi
    done
  }

  sign_mach_o_binaries "$AGENTS_DIR" "agents"
  sign_mach_o_binaries "$SIDECAR_DIR" "sidecar/node-pty"

  echo "Third-party binaries signed."
fi

# --- 3. Build Application ---
echo "Building application..."

# Export signing variables so Tauri picks them up for automatic signing + notarization
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
export APPLE_ID="${APPLE_ID:-}"
export APPLE_PASSWORD="${APPLE_PASSWORD:-}"
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

pnpm build

# --- 4. Locate and Verify App Bundle ---
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

# --- 5. Zip the Bundle ---
DIST_ZIP_NAME="Anvil-${NEW_VERSION}.zip"
ZIP_PATH="src-tauri/target/release/bundle/macos/${DIST_ZIP_NAME}"

echo "Creating zip archive: ${DIST_ZIP_NAME}..."
cd src-tauri/target/release/bundle/macos
zip -r -q "${DIST_ZIP_NAME}" Anvil.app
cd - > /dev/null

echo "Zip created: ${ZIP_PATH}"

# --- 5b. Locate the DMG ---
SEMVER_VERSION="${NEW_VERSION#v}"
DMG_PATH="src-tauri/target/release/bundle/dmg/Anvil_${SEMVER_VERSION}_aarch64.dmg"
DIST_DMG_NAME="Anvil-${NEW_VERSION}.dmg"

if [ ! -f "$DMG_PATH" ]; then
  echo "Error: DMG not found at ${DMG_PATH}"
  exit 1
fi

cp "$DMG_PATH" "src-tauri/target/release/bundle/dmg/${DIST_DMG_NAME}"
echo "DMG ready: ${DIST_DMG_NAME}"

# --- 6. Upload to Cloudflare R2 ---
echo "Uploading to Cloudflare R2 (anvil-builds)..."

# Upload DMG
npx wrangler r2 object put "anvil-builds/builds/${NEW_VERSION}/${DIST_DMG_NAME}" \
  --file="src-tauri/target/release/bundle/dmg/${DIST_DMG_NAME}" \
  --content-type="application/x-apple-diskimage" \
  --remote

echo "Uploaded ${DIST_DMG_NAME} to R2"

# Upload zip
npx wrangler r2 object put "anvil-builds/builds/${NEW_VERSION}/${DIST_ZIP_NAME}" \
  --file="${ZIP_PATH}" \
  --content-type="application/zip" \
  --remote

echo "Uploaded ${DIST_ZIP_NAME} to R2"

# --- 7. Update Version File ---
echo "Updating version file..."

VERSION_FILE=$(mktemp)
echo -n "${NEW_VERSION}" > "$VERSION_FILE"

npx wrangler r2 object put "anvil-builds/distribute/version" \
  --file="$VERSION_FILE" \
  --content-type="text/plain" \
  --remote

rm "$VERSION_FILE"

echo "Version file updated to ${NEW_VERSION}"

# --- 8. Upload Install Script + Animation ---
echo "Uploading install script..."

npx wrangler r2 object put "anvil-builds/distribute/install.sh" \
  --file="scripts/installation/install.sh" \
  --content-type="text/plain" \
  --remote

echo "Install script uploaded."

echo "Uploading animation script..."

npx wrangler r2 object put "anvil-builds/distribute/anvil-animation.sh" \
  --file="scripts/installation/anvil-animation.sh" \
  --content-type="text/plain" \
  --remote

echo "Animation script uploaded."

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
echo "  DMG: src-tauri/target/release/bundle/dmg/${DIST_DMG_NAME}"
echo "  R2:  anvil-builds/builds/${NEW_VERSION}/"
echo "=========================================="
echo ""
echo "Users can install with:"
echo "  curl -sL https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev/distribute/install.sh | bash"
