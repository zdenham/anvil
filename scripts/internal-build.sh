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
pnpm build

# --- 3. Zip the Bundle ---
APP_PATH="src-tauri/target/release/bundle/macos/Mort.app"
ZIP_NAME="${NEW_VERSION}.zip"
ZIP_PATH="src-tauri/target/release/bundle/macos/${ZIP_NAME}"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: App bundle not found at ${APP_PATH}"
  exit 1
fi

echo "Creating zip archive: ${ZIP_NAME}..."
cd src-tauri/target/release/bundle/macos
zip -r -q "${ZIP_NAME}" Mort.app
cd - > /dev/null

echo "Zip created: ${ZIP_PATH}"

# --- 4. Upload to Cloudflare R2 ---
echo "Uploading to Cloudflare R2..."

# Upload the zip to mort-builds/
npx wrangler r2 object put "mort-builds/mort-builds/${ZIP_NAME}" \
  --file="${ZIP_PATH}" \
  --content-type="application/zip" \
  --remote

echo "Uploaded ${ZIP_NAME} to mort-builds/"

# --- 5. Update Version File ---
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
echo "  Zip: ${ZIP_PATH}"
echo "  R2 path: mort-builds/${ZIP_NAME}"
echo "=========================================="
echo ""
echo "Users can install with:"
echo "  curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/distribute_internally.sh | bash"
