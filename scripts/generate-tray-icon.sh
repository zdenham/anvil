#!/bin/bash
# Generate macOS menu bar template icons from icon-black.png
# Uses macOS built-in sips tool (no dependencies required)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$PROJECT_ROOT/src-tauri/icons"
SOURCE_ICON="$PROJECT_ROOT/icon-cropped-thicker.png"

echo "Generating tray icons from $SOURCE_ICON..."

# Create temp directory for intermediate files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copy source to temp for manipulation
cp "$SOURCE_ICON" "$TEMP_DIR/source.png"

# Generate 22x22 (1x) version
sips -z 22 22 "$TEMP_DIR/source.png" --out "$ICONS_DIR/tray-icon.png" > /dev/null 2>&1
echo "Created tray-icon.png (22x22)"

# Copy source again (sips modifies in place sometimes)
cp "$SOURCE_ICON" "$TEMP_DIR/source2.png"

# Generate 44x44 (2x Retina) version
sips -z 44 44 "$TEMP_DIR/source2.png" --out "$ICONS_DIR/tray-icon@2x.png" > /dev/null 2>&1
echo "Created tray-icon@2x.png (44x44)"

# Verify the output
echo ""
echo "Generated icons:"
ls -la "$ICONS_DIR"/tray-icon*.png

echo ""
echo "Done! Template icons created for macOS menu bar."
echo "Note: These icons use black shapes on transparent background."
echo "macOS will automatically invert colors for light/dark mode when icon_as_template(true) is set."
