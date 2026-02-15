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

# 11. Patch installed dist user-facing messages (Clawdbot -> Phoenix)
#     v2026.2.13+ upstream renamed OpenClaw to Clawdbot in compiled output.
#     The gateway serves from installed dist, not local builds.
if [ -n "$CLAWDBOT_PKG" ] && [ -d "$CLAWDBOT_PKG/dist" ]; then
  DIST="$CLAWDBOT_PKG/dist"
  echo "  - Patching installed dist at $DIST"

  # "Clawdbot: access not configured." -> "Phoenix: access not configured."
  for F in "$DIST/pairing/pairing-messages.js" "$DIST/telegram/bot-message-context.js"; do
    [ -f "$F" ] && sed -i '' 's/"Clawdbot: access not configured\."/"Phoenix: access not configured."/g' "$F"
  done

  # "clawdbot pairing approve" -> "phoenix pairing approve"
  for F in \
    "$DIST/pairing/pairing-messages.js" \
    "$DIST/telegram/bot-message-context.js" \
    "$DIST/channels/plugins/helpers.js" \
    "$DIST/cli/pairing-cli.js" \
    "$DIST/commands/onboard-channels.js" \
    "$DIST/commands/onboard-providers.js" \
    "$DIST/providers/plugins/helpers.js"; do
    [ -f "$F" ] && sed -i '' 's/clawdbot pairing approve/phoenix pairing approve/g' "$F"
  done

  # "clawdbot pairing list" -> "phoenix pairing list"
  for F in "$DIST/channels/plugins/helpers.js" "$DIST/providers/plugins/helpers.js"; do
    [ -f "$F" ] && sed -i '' 's/clawdbot pairing list/phoenix pairing list/g' "$F"
  done

  # Also patch any extension dist dirs
  for EXT_DIST in "$CLAWDBOT_PKG/dist/extensions"/*/; do
    if [ -d "$EXT_DIST" ]; then
      for F in $(grep -rl '"Clawdbot:\|clawdbot pairing' "$EXT_DIST" 2>/dev/null); do
        sed -i '' 's/"Clawdbot: access not configured\."/"Phoenix: access not configured."/g' "$F"
        sed -i '' 's/clawdbot pairing approve/phoenix pairing approve/g' "$F"
        sed -i '' 's/clawdbot pairing list/phoenix pairing list/g' "$F"
      done
    fi
  done

  echo "  - Dist patched: Phoenix branding in pairing/CLI messages"

  # 12. Patch dispatch-from-config.js to emit message:inbound hook events
  #     This enables the message-filter hook to intercept inbound messages.
  DISPATCH="$DIST/auto-reply/reply/dispatch-from-config.js"
  if [ -f "$DISPATCH" ]; then
    # Only patch if not already patched
    if ! grep -q 'message:inbound' "$DISPATCH" 2>/dev/null; then
      # Add import for hook system
      sed -i '' '/import.*tts\.js/a\
import { createInternalHookEvent, triggerInternalHook } from "../../hooks/internal-hooks.js";
' "$DISPATCH"

      # Add filter logic after the dedupe check
      sed -i '' '/return { queuedFinal: false, counts: dispatcher.getQueuedCounts() };/{
        # Only patch after the "duplicate" recordProcessed line
        N
        /duplicate/!b skip_patch
        s/\(return { queuedFinal: false, counts: dispatcher.getQueuedCounts() };\)/\1/
        :skip_patch
      }' "$DISPATCH" 2>/dev/null || true

      # Simpler approach: use node to patch
      node -e "
        const fs = require('fs');
        let code = fs.readFileSync('$DISPATCH', 'utf-8');
        if (!code.includes('message:inbound')) {
          // Add import
          code = code.replace(
            /import.*normalizeTtsAutoMode.*from.*tts\.js.*/,
            match => match + '\nimport { createInternalHookEvent, triggerInternalHook } from \"../../hooks/internal-hooks.js\";'
          );
          // Add filter after dedupe
          code = code.replace(
            /(if \(shouldSkipDuplicateInbound\(ctx\)\) \{[^}]+\})/s,
            '\$1\n' +
            '    // message:inbound hook (message-filter)\n' +
            '    const filterBody = typeof ctx.BodyForCommands === \"string\" ? ctx.BodyForCommands : typeof ctx.CommandBody === \"string\" ? ctx.CommandBody : typeof ctx.RawBody === \"string\" ? ctx.RawBody : typeof ctx.Body === \"string\" ? ctx.Body : \"\";\n' +
            '    const filterContext = { bodyForCommands: filterBody, senderId: ctx.From ?? ctx.SenderId ?? \"\", channel, chatType: ctx.ChatType, messageId, cfg };\n' +
            '    const filterEvent = createInternalHookEvent(\"message\", \"inbound\", sessionKey ?? \"\", filterContext);\n' +
            '    await triggerInternalHook(filterEvent);\n' +
            '    if (filterContext.skip === true) { recordProcessed(\"skipped\", { reason: filterContext.skipReason ?? \"message-filter\" }); return { queuedFinal: false, counts: dispatcher.getQueuedCounts() }; }'
          );
          fs.writeFileSync('$DISPATCH', code);
          console.log('    - dispatch-from-config.js patched with message:inbound hook');
        } else {
          console.log('    - dispatch-from-config.js already patched');
        }
      "
    else
      echo "  - dispatch-from-config.js already has message:inbound hook"
    fi
  fi
fi

echo ""
echo "Phoenix rebranding complete!"
echo ""
echo "Remember to rebuild: pnpm build"
