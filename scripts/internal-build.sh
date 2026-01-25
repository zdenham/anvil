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

# --- 2. Sign Third-Party Binaries ---
# Tauri only signs its own binaries. We need to sign any native binaries
# from node_modules that get bundled as resources.
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "Signing third-party native binaries..."

  AGENTS_DIR="$REPO_ROOT/agents/node_modules/@anthropic-ai"

  if [ -d "$AGENTS_DIR" ]; then
    # Find and sign all .node files and darwin executables
    # Use -L to follow symlinks (pnpm uses symlinks in node_modules)
    find -L "$AGENTS_DIR" -type f \( -name "*.node" -o -name "rg" \) | while read -r binary; do
      # Only sign darwin binaries
      if file "$binary" | grep -q "Mach-O"; then
        # Resolve symlinks to get the real path
        REAL_BINARY=$(realpath "$binary")
        echo "  Signing: $REAL_BINARY"
        codesign --force --options runtime --timestamp \
          --sign "$APPLE_SIGNING_IDENTITY" \
          --entitlements "$REPO_ROOT/src-tauri/entitlements.plist" \
          "$REAL_BINARY"
      fi
    done

    echo "Third-party binaries signed."
  else
    echo "Warning: agents directory not found at $AGENTS_DIR"
  fi
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
APP_PATH="src-tauri/target/release/bundle/macos/Mort.app"

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
ZIP_NAME="${NEW_VERSION}.zip"
ZIP_PATH="src-tauri/target/release/bundle/macos/${ZIP_NAME}"

echo "Creating zip archive: ${ZIP_NAME}..."
cd src-tauri/target/release/bundle/macos
zip -r -q "${ZIP_NAME}" Mort.app
cd - > /dev/null

echo "Zip created: ${ZIP_PATH}"

# --- 6. Upload to Cloudflare R2 ---
echo "Uploading to Cloudflare R2..."

# Upload the zip to mort-builds/
npx wrangler r2 object put "mort-builds/mort-builds/${ZIP_NAME}" \
  --file="${ZIP_PATH}" \
  --content-type="application/zip" \
  --remote

echo "Uploaded ${ZIP_NAME} to mort-builds/"

# --- 7. Update Version File ---
echo "Updating version file..."

# Create temporary version file
VERSION_FILE=$(mktemp)
echo -n "${NEW_VERSION}" > "$VERSION_FILE"

# Upload version file
npx wrangler r2 object put "mort-builds/mort-installation-scripts/version" \
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
echo "  R2 path: mort-builds/${ZIP_NAME}"
echo "=========================================="
echo ""
echo "Users can install with:"
echo "  curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/distribute_internally.sh | bash"
