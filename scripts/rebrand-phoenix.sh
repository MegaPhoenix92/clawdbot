#!/bin/bash
# Rebrand OpenClaw to Phoenix for TROZLAN
# Run this after npm updates to restore Phoenix branding

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "Rebranding OpenClaw to Phoenix..."

# 1. Pairing messages - user-facing "access not configured" message
sed -i '' 's/"OpenClaw: access not configured\."/"Phoenix: access not configured."/g' \
  src/pairing/pairing-messages.ts

# 2. Telegram bot context - same message
sed -i '' 's/"OpenClaw: access not configured\."/"Phoenix: access not configured."/g' \
  src/telegram/bot-message-context.ts

# 3. Matrix extension - pairing message
sed -i '' 's/"OpenClaw: access not configured\."/"Phoenix: access not configured."/g' \
  extensions/matrix/src/matrix/monitor/handler.ts

# 4. Matrix device name
sed -i '' 's/"OpenClaw Gateway"/"Phoenix Gateway"/g' \
  extensions/matrix/src/matrix/client/config.ts
sed -i '' 's/"OpenClaw Gateway"/"Phoenix Gateway"/g' \
  extensions/matrix/src/onboarding.ts

# 5. UI Dashboard branding
sed -i '' 's/alt="OpenClaw"/alt="Phoenix"/g' \
  ui/src/ui/app-render.ts
sed -i '' 's/<div class="brand-title">OPENCLAW<\/div>/<div class="brand-title">PHOENIX<\/div>/g' \
  ui/src/ui/app-render.ts

# 5b. Replace favicon with Phoenix logo (basePath-aware pattern from v2026.2.9+)
if [ -f "ui/public/phoenix-logo.png" ]; then
  sed -i '' 's|/favicon\.svg|/phoenix-logo.png|g' \
    ui/src/ui/app-render.ts
  echo "  - Logo replaced with phoenix-logo.png"
else
  echo "  - WARNING: ui/public/phoenix-logo.png not found, keeping default logo"
fi

# 6. Gateway client name - DO NOT CHANGE
# The client ID "openclaw-control-ui" is validated by the gateway protocol
# and must remain unchanged for WebSocket connections to work

# 7. Channels plugin helper - if there's a user-facing message
if grep -q '"OpenClaw:' src/channels/plugins/helpers.ts 2>/dev/null; then
  sed -i '' 's/"OpenClaw:/"Phoenix:/g' src/channels/plugins/helpers.ts
fi

# 8. Pairing approve commands - user-facing CLI hints in messaging channels
# Note: feishu moved to extensions/feishu/ in v2026.2.9 and no longer has inline pairing messages
sed -i '' 's/openclaw pairing approve/phoenix pairing approve/g' \
  src/pairing/pairing-messages.ts \
  src/telegram/bot-message-context.ts \
  extensions/matrix/src/matrix/monitor/handler.ts \
  src/channels/plugins/helpers.ts \
  extensions/line/src/channel.ts

# 9. Pairing list commands - user-facing CLI hints
sed -i '' 's/openclaw pairing list/phoenix pairing list/g' \
  src/channels/plugins/helpers.ts

# 10. Patch installed control-ui (the dashboard served by npx clawdbot gateway)
#     The npm-installed package has pre-built UI assets that need patching too.
CLAWDBOT_BIN="$(which clawdbot 2>/dev/null || echo "")"
if [ -n "$CLAWDBOT_BIN" ]; then
  CLAWDBOT_PKG="$(dirname "$(dirname "$(readlink -f "$CLAWDBOT_BIN" 2>/dev/null || realpath "$CLAWDBOT_BIN" 2>/dev/null || echo "")")")"
  CONTROL_UI="$CLAWDBOT_PKG/dist/control-ui"
else
  # Fallback: look in common nvm location
  CONTROL_UI=""
  for NODE_DIR in /Users/chrisozsvath/.nvm/versions/node/*/lib/node_modules/clawdbot/dist/control-ui; do
    if [ -f "$NODE_DIR/index.html" ]; then
      CONTROL_UI="$NODE_DIR"
      break
    fi
  done
fi

if [ -n "$CONTROL_UI" ] && [ -f "$CONTROL_UI/index.html" ]; then
  echo "  - Patching installed control-ui at $CONTROL_UI"
  # Replace CLAWDBOT with PHOENIX in bundled JS
  for JS in "$CONTROL_UI"/assets/*.js; do
    if [ -f "$JS" ]; then
      sed -i '' 's/CLAWDBOT/PHOENIX/g' "$JS"
      # Replace lobster CDN logo with local phoenix logo
      sed -i '' 's|https://mintcdn\.com/clawdhub/[^"]*pixel-lobster[^"]*|./phoenix-logo.png|g' "$JS"
    fi
  done
  # Update HTML title and favicon
  sed -i '' 's/<title>Clawdbot Control<\/title>/<title>Phoenix Gateway<\/title>/' "$CONTROL_UI/index.html"
  sed -i '' 's/<title>OpenClaw Control<\/title>/<title>Phoenix Gateway<\/title>/' "$CONTROL_UI/index.html"
  sed -i '' 's|href="./favicon.ico"|href="./phoenix-logo.png" type="image/png"|' "$CONTROL_UI/index.html"
  # Copy phoenix logo
  if [ -f "ui/public/phoenix-logo.png" ]; then
    cp ui/public/phoenix-logo.png "$CONTROL_UI/"
  fi
  echo "  - Control UI patched: PHOENIX branding + phoenix-logo.png"
else
  echo "  - WARNING: Could not find installed control-ui to patch"
fi

echo ""
echo "Phoenix rebranding complete!"
echo ""
echo "Remember to rebuild: pnpm build"
