cat << 'EOF'

      ▄▀▀▀▄
     █ ◠◡◠ █
      ▀▄▄▄▀

  mortician inbound... 

EOF

VERSION=$(curl -sL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-installation-scripts/version)

echo "Installing Mort ${VERSION}..."

echo "Quitting existing Mort..."
killall mort 2>/dev/null || true

echo "Cleaning up old files..."
rm -rf ~/Downloads/Mort.zip ~/Downloads/Mort.app /Applications/Mort.app

echo "Downloading Mort ${VERSION}..."
curl -fL https://pub-484a71c5f2f240489aee02d684dbb550.r2.dev/mort-builds/${VERSION}.zip -o ~/Downloads/Mort.zip

if [ ! -f ~/Downloads/Mort.zip ]; then
    echo "Error: Failed to download Mort ${VERSION}. Build may not exist."
    exit 1
fi

echo "Extracting..."
unzip -o -q ~/Downloads/Mort.zip -d ~/Downloads/ -x "__MACOSX/*"

echo "Moving to Applications..."
mv ~/Downloads/Mort.app /Applications/

echo "Opening Mort..."
xattr -rd com.apple.quarantine /Applications/Mort.app 2>/dev/null || true
open /Applications/Mort.app

# Force activation - `open` from a backgrounded shell process doesn't
# reliably activate the app, leaving WKWebView in a broken focus state
sleep 2
osascript -e 'tell application "Mort" to activate' 2>/dev/null || true

echo "Done!"
