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

# 5b. Replace favicon with Phoenix logo
if [ -f "ui/public/phoenix-logo.png" ]; then
  sed -i '' 's|src="/favicon.svg"|src="/phoenix-logo.png"|g' \
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
sed -i '' 's/openclaw pairing approve/phoenix pairing approve/g' \
  src/pairing/pairing-messages.ts \
  src/telegram/bot-message-context.ts \
  extensions/matrix/src/matrix/monitor/handler.ts \
  src/channels/plugins/helpers.ts \
  src/feishu/message.ts \
  extensions/line/src/channel.ts

# 9. Pairing list commands - user-facing CLI hints
sed -i '' 's/openclaw pairing list/phoenix pairing list/g' \
  src/channels/plugins/helpers.ts

# 10. Feishu branding
sed -i '' 's/"OpenClaw access not configured\."/"Phoenix: access not configured."/g' \
  src/feishu/message.ts
sed -i '' 's/Ask the OpenClaw admin/Ask the Phoenix admin/g' \
  src/feishu/message.ts

echo "Phoenix rebranding complete!"
echo ""
echo "Files modified:"
echo "  - src/pairing/pairing-messages.ts"
echo "  - src/telegram/bot-message-context.ts"
echo "  - extensions/matrix/src/matrix/monitor/handler.ts"
echo "  - extensions/matrix/src/matrix/client/config.ts"
echo "  - extensions/matrix/src/onboarding.ts"
echo "  - ui/src/ui/app-render.ts"
echo "  - ui/src/ui/app-gateway.ts"
echo ""
echo "Remember to rebuild the UI: pnpm build"
