cat << 'EOF'

      ▄▀▀▀▄
     █ ◠◡◠ █
      ▀▄▄▄▀

  anvil inbound...

EOF

# TODO(anvil-rename): update when infra is migrated
VERSION=$(curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/version)

echo "Installing Anvil ${VERSION}..."

echo "Quitting existing Anvil..."
killall anvil 2>/dev/null || true

echo "Cleaning up old files..."
rm -rf ~/Downloads/Anvil.zip ~/Downloads/Anvil.app /Applications/Anvil.app

echo "Downloading Anvil ${VERSION}..."
# TODO(anvil-rename): update when infra is migrated
curl -fL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-builds/${VERSION}.zip -o ~/Downloads/Anvil.zip

if [ ! -f ~/Downloads/Anvil.zip ]; then
    echo "Error: Failed to download Anvil ${VERSION}. Build may not exist."
    exit 1
fi

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
