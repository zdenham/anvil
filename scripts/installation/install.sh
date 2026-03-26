#!/bin/bash
set -e

# Download animation assets
ANIM_SCRIPT=$(mktemp)
curl -sfL https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev/distribute/anvil-animation.sh -o "$ANIM_SCRIPT" 2>/dev/null

if [ -f "$ANIM_SCRIPT" ] && [ -s "$ANIM_SCRIPT" ]; then
  source "$ANIM_SCRIPT"
  init_anvil_animation
  play_anvil_animation &
  ANIM_PID=$!
else
  cat << 'EOF'

               +xxxxx          xxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                xxxxxxxxxxxxx  xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                  xxx-        xxx                       xxx+
                   xxxxx.     xxx                xxxxxxxxxxx
                       +xxxxx xxxxx          xxxxxxx-
                           +x xxxxxxx      xxxxxx
                                  .xxx     xxx
                                   xxx     xxx
                                 xxxx      xxxx
                               .xxxx        xxxx+
                           xxxxxx   xxxxxxxxx  xxxxxx.
                         xxxxx     xxxx++xxxx-    xxxxx
                       -xxxxxxxxxxxxx       xxxxxxxxxxxx

  anvil inbound...

EOF
fi

VERSION=$(curl -sL https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev/distribute/version)

echo "Installing Anvil ${VERSION}..."

echo "Quitting existing Anvil..."
killall anvil 2>/dev/null || true

echo "Cleaning up old files..."
rm -rf ~/Downloads/Anvil.zip ~/Downloads/Anvil.app /Applications/Anvil.app

echo "Downloading Anvil ${VERSION}..."
curl -fL https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev/builds/${VERSION}/Anvil-${VERSION}.zip -o ~/Downloads/Anvil.zip

if [ ! -f ~/Downloads/Anvil.zip ]; then
    echo "Error: Failed to download Anvil ${VERSION}. Build may not exist."
    exit 1
fi

# Stop animation, show final anvil frame
if [ -n "${ANIM_PID:-}" ]; then
  stop_anvil_animation "$ANIM_PID"
fi
rm -f "$ANIM_SCRIPT"

echo "Extracting..."
unzip -o -q ~/Downloads/Anvil.zip -d ~/Downloads/ -x "__MACOSX/*"

echo "Moving to Applications..."
mv ~/Downloads/Anvil.app /Applications/

echo "Opening Anvil..."
xattr -rd com.apple.quarantine /Applications/Anvil.app 2>/dev/null || true
open /Applications/Anvil.app

# Force activation - `open` from a backgrounded shell process doesn't
# reliably activate the app, leaving WKWebView in a broken focus state
sleep 2
osascript -e 'tell application "Anvil" to activate' 2>/dev/null || true

echo "Done!"
