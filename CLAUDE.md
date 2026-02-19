# Phoenix Gateway (TROZLAN Fork)

> See `AGENTS.md` for upstream repository guidelines (coding style, testing, build commands, PR workflow, etc.).
> This file covers TROZLAN-specific deployment, branding, and operational context.

## Fork Identity

| Property            | Value                                                              |
| ------------------- | ------------------------------------------------------------------ |
| **Upstream**        | `openclaw/openclaw` (remote: `upstream`)                           |
| **Fork**            | `MegaPhoenix92/clawdbot` (remote: `origin`)                        |
| **Branding**        | "Phoenix" (user-facing), `clawdbot`/`openclaw` (internal/protocol) |
| **Current Version** | v2026.2.19                                                         |
| **Node**            | v22.22.0 (required)                                                |
| **Package Manager** | pnpm (NOT npm — npm fails with arborist errors on this workspace)  |

## Update Flow

```bash
# 1. Fetch upstream tags
git fetch upstream --tags

# 2. Merge the new version
git merge v<YYYY.M.D>

# 3. Resolve merge conflicts (rebrand lines are expected conflicts — take upstream, rebrand script re-applies)

# 4. Rebrand
./scripts/rebrand-phoenix.sh

# 5. Install and build
pnpm install && pnpm build
```

## Update Persistence (Important)

- App updates can overwrite repo files and installed package files (`openclaw update`, global npm updates, upstream merge/rebase).
- Keep durable assistant behavior in workspace files (`~/.openclaw/workspace` by default): `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, and `memory/*.md`.
- Workspace bootstrap files are only created if missing (write mode `wx`), so existing workspace `AGENTS.md`/`SOUL.md`/`USER.md` are not replaced by normal setup/update runs.
- Treat this repo-root `CLAUDE.md` + `AGENTS.md` as fork/operator docs. Keep them in git, but do not rely on them as the only source of runtime behavior.

## Fork-Local Source Modifications

When modifying upstream `src/` files in the fork, merge conflicts are expected on upstream updates. Follow this protocol:

### Strategy: Upstream-First

**Always prefer upstreaming bug fixes and features as PRs to `openclaw/openclaw`.** This eliminates future merge conflicts entirely once accepted. Fork-local modifications to `src/` files should be temporary — kept only until the upstream PR is merged.

### When Fork-Local Modifications Are Necessary

If a fix is needed immediately and can't wait for upstream review:

1. **Commit locally on `main`** with a clear commit message prefixed `fix (agents):` or similar
2. **Create an upstream PR branch** from `upstream/main`, cherry-pick the commit, resolve conflicts, push to `origin`, and open PR via `gh pr create --repo clawdbot/clawdbot`
3. **Document the modification** in the table below
4. **On next upstream merge**, if the PR was accepted, the conflict auto-resolves. If not, resolve manually (our additions are typically additive — keep both upstream's new code and our additions)

### Active Fork-Local Modifications

| File                                           | Change                                                                                | Conflict Risk | Notes                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `src/hooks/internal-hooks.ts`                  | `InboundMessageHookContext` type + `isInboundMessageEvent()`                          | Low           | Coexists with upstream's `MessageReceivedHookContext` (different purpose: pre-filter vs lifecycle) |
| `src/auto-reply/reply/dispatch-from-config.ts` | Import `InboundMessageHookContext`, fire `message:inbound` event                      | Medium        | Integration point for message-filter hook                                                          |
| `src/hooks/bundled/message-filter/`            | Bundled internal hook (handler + test)                                                | None          | Entirely new directory, no upstream equivalent                                                     |
| `extensions/voice-call/src/webhook.ts`         | Cleanup calls in `onDisconnect` (`markResponseDisconnected`, `clearSingleTopicState`) | Low           | Additive alongside upstream's auto-end on disconnect                                               |
| `extensions/voice-call/src/manager.test.ts`    | `onCallEnded` callback tests                                                          | Low           | Appended test block                                                                                |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Wrap `transformContext` with `sanitizeToolUseResultPairing` safety net                | Low           | Additive after session creation; gated by `transcriptPolicy.repairToolUseResultPairing`            |
| `src/agents/pi-embedded-runner/compact.ts`     | Same `transformContext` safety net                                                    | Low           | Same pattern as attempt.ts                                                                         |
| `src/plugins/runtime/index.ts`                 | Add `resolveMainSessionKey` to `createRuntimeSystem()` + import                       | Medium        | Upstream type requires it but implementation omits it; our fix restores it                         |

**Resolved (v2026.2.17):** Subagent retry timer (our PR [#18205](https://github.com/openclaw/openclaw/pull/18205)) — upstream independently implemented a more sophisticated per-entry retry mechanism with exponential backoff (1s-8s), 5-minute expiry, and max 3 retries. Our periodic timer code was removed in favor of upstream's approach.

### Merge Conflict Resolution Guide

When upstream updates a file we've modified:

1. **Check the modifications table** — understand what our fork adds vs what upstream owns
2. **For additive code** (new functions, new type fields): keep both sides
3. **For integration points** (calls wired into existing functions): take upstream's version, re-apply our 1-2 line additions
4. **Run tests after resolution**: `pnpm test` (unit) and `pnpm test:e2e` (e2e)
5. **Update this table** — add new entries or remove resolved ones

## Rebrand Script (`scripts/rebrand-phoenix.sh`)

Run after every upstream merge or npm update. It patches:

1. **Source files** — "OpenClaw" -> "Phoenix" in pairing messages, Telegram, Matrix, UI dashboard, channel helpers, CLI hints
2. **Installed control-ui** — The dashboard served by `npx clawdbot gateway` comes from the npm-installed package, NOT from local builds. The script patches the installed package's HTML title, bundled JS (CLAWDBOT->PHOENIX), favicon, and CDN lobster logo URL.
3. **Logo** — Replaces upstream favicon/lobster with `ui/public/phoenix-logo.png` (cartoonish bird on blue background)

**DO NOT change** the client ID `openclaw-control-ui` — it's validated by the WebSocket protocol.

## Configuration

| Item                    | Location                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| **Main config**         | `~/.openclaw/openclaw.json` (canonical — see Config Symlink below) |
| **Legacy config**       | `~/.clawdbot/clawdbot.json` → symlink to openclaw.json             |
| **Env vars**            | `.env` in project root                                             |
| **Sessions**            | `~/.openclaw/sessions/`                                            |
| **Credentials**         | `~/.openclaw/credentials/`                                         |
| **Logs (source build)** | `/tmp/openclaw/openclaw-YYYY-MM-DD.log`                            |
| **Logs (npx clawdbot)** | `/tmp/clawdbot/clawdbot-YYYY-MM-DD.log`                            |

### Config Symlink (Important)

The gateway config resolution checks **multiple paths in priority order**. The top candidates are:

1. `~/.openclaw/openclaw.json` (priority 7 — new default)
2. `~/.clawdbot/clawdbot.json` (priority 9 — legacy)

If both files exist independently, they **drift out of sync** (e.g. iMessage enabled in one but disabled in the other). This caused iMessage to silently not start when switching between `npx clawdbot gateway` and source builds.

**Fix:** A single canonical file with a symlink:

```
~/.openclaw/openclaw.json          ← canonical (edit this one)
~/.clawdbot/clawdbot.json  →  ~/.openclaw/openclaw.json  (symlink)
~/.clawdbot/clawdbot.json.bak     ← backup of old standalone file
```

This ensures both `npx clawdbot gateway` and `node openclaw.mjs gateway` read the same config regardless of which path the resolver picks.

**To recreate if lost:**

```bash
ln -sf ~/.openclaw/openclaw.json ~/.clawdbot/clawdbot.json
```

**Do NOT** create a standalone `~/.clawdbot/clawdbot.json` — it will silently diverge from the openclaw config and cause hard-to-debug channel startup failures.

## Model Registry Fix

The gateway's model registry (in the npm-installed package) only knows models up to `claude-opus-4-5`. To use newer models like `claude-opus-4-6`, add them as **inline models** via `models.providers.anthropic` in the config:

```json
{
  "models": {
    "providers": {
      "anthropic": {
        "api": "anthropic-messages",
        "baseUrl": "https://api.anthropic.com",
        "models": [
          {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4.6",
            "api": "anthropic-messages",
            "reasoning": true,
            "input": ["text", "image"],
            "cost": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25 },
            "contextWindow": 200000,
            "maxTokens": 64000
          }
        ]
      }
    }
  }
}
```

**IMPORTANT:** `baseUrl` is required by the config schema — omitting it causes a validation error and the gateway refuses to start.

This is the **supported mechanism** — `resolveModel()` in `pi-embedded-runner/model.js` checks `cfg.models.providers` before erroring. It survives npm updates (unlike patching installed files).

**DO NOT** patch files in `node_modules` or the global npm install to fix model issues.

## Gateway Management

```bash
# Start (in tmux for FDA access to iMessage)
tmux new-session -d -s clawdbot-gateway \
  'export PATH=/Users/chrisozsvath/.nvm/versions/node/v22.22.0/bin:$PATH && npx clawdbot gateway'

# Check status
tmux capture-pane -t clawdbot-gateway -p | tail -20

# Stop
tmux kill-session -t clawdbot-gateway

# Dashboard
# URL: http://localhost:18789
# Token: b12e4c3f2868e7b83a3c80a209eac17b09e3ba3e8b32dfe8
```

**iMessage requires Full Disk Access** — Terminal.app must have FDA granted in System Settings. Running from tmux inherits Terminal's FDA permissions.

## Active Channels

| Channel        | Status  | Notes                                                       |
| -------------- | ------- | ----------------------------------------------------------- |
| **iMessage**   | Active  | Requires FDA, uses `imsg` CLI tool                          |
| **Voice Call** | Active  | Twilio + OpenAI Realtime STT + ElevenLabs TTS (Bella voice) |
| **SMS**        | Pending | A2P 10DLC campaign under review                             |

## Voice Call Setup

| Property           | Value                                                               |
| ------------------ | ------------------------------------------------------------------- |
| **Phone**          | +1(404)844-5935                                                     |
| **Allowlist**      | +14046637573, +14048089941                                          |
| **STT**            | OpenAI Realtime (`gpt-4o-transcribe`)                               |
| **TTS**            | ElevenLabs Bella (`hpp4J3VqNfWAUOO0d1Us`, `eleven_multilingual_v2`) |
| **Response Model** | `anthropic/claude-haiku-4-5-20251001` (separate from agent model)   |
| **Webhook**        | `https://phoenix-voice.trozlan.io/voice/webhook`                    |
| **Tunnel**         | Cloudflare `networks-trozlan`                                       |

Voice agent has full tool support via `runEmbeddedPiAgent()` (same pipeline as messaging channels). The `responseTimeoutMs` is 8000ms — may need bumping for tool-heavy responses.

## Cloudflare Tunnel

```bash
# Config location
/Users/chrisozsvath/Projects/TROZLAN/TROZLANIO/networks/cloudflared-config.yml

# Start tunnel
cloudflared tunnel --config /path/to/cloudflared-config.yml run networks-trozlan
```

Tunnel name: `networks-trozlan` (ID: `b430efe7-f059-4781-bb95-d8c78f736fe9`)

**Gotcha:** `cloudflared tunnel route dns` picks the wrong zone — use the Cloudflare dashboard for DNS changes.
**Token fix (v2026.2.13):** Upstream fixed token passing via `<Parameter>` instead of URL query params.

## Message Filter Hook

Bundled internal hook that silently drops junk messages (OTP codes, marketing, appointment reminders, fitness notifications, delivery updates, banking alerts). Opt-in only.

**Enable in config:**

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "message-filter": { "enabled": true }
      }
    }
  }
}
```

**Source:** `src/hooks/bundled/message-filter/handler.ts`
**Tests:** `src/hooks/bundled/message-filter/handler.test.ts`

Features:

- Regex-based (zero latency, zero token cost)
- 6 categories: otp, marketing, appointments, fitness, delivery, banking
- Command bypass: messages starting with `/` are never filtered
- Allowed/blocked sender lists
- Safe logging (never logs message body by default)

## Installed Package Paths

The npm-installed `clawdbot` package lives at:

```
/Users/chrisozsvath/.nvm/versions/node/v22.22.0/lib/node_modules/clawdbot/
```

Key locations within:

- `dist/control-ui/` — Dashboard UI assets (patched by rebrand script)
- `dist/agents/opencode-zen-models.js` — Model registry (static fallback)
- `dist/agents/live-model-filter.js` — Model prefix filter
- `dist/agents/pi-embedded-runner/model.js` — Model resolution (`resolveModel()`)

## Git Remotes

```
origin    git@github.com:MegaPhoenix92/clawdbot.git
upstream  git@github.com:openclaw/openclaw.git
```

## Sibling Repo

The `phoenix/` sibling repo at `/Users/chrisozsvath/Projects/TROZLAN/TROZLANIO/phoenix` is a parallel fork of the same upstream, used for source-level builds. Keep both repos in sync when updating.
