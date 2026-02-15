import { spawn } from "node:child_process";
import http from "node:http";
import { URL } from "node:url";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "openclaw/plugin-sdk";
import type { VoiceCallConfig } from "./config.js";
import type { CoreConfig } from "./core-bridge.js";
import type { CallManager } from "./manager.js";
import type { MediaStreamConfig } from "./media-stream.js";
import type { VoiceCallProvider } from "./providers/base.js";
import type { TwilioProvider } from "./providers/twilio.js";
import type { NormalizedEvent, WebhookContext } from "./types.js";
import { MediaStreamHandler } from "./media-stream.js";
import { OpenAIRealtimeSTTProvider } from "./providers/stt-openai-realtime.js";
import {
  createVoiceCallResponseCueController,
  resolveVoiceCallResponseCuePlan,
  type VoiceCallResponseCueKind,
} from "./response-cues.js";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

const TRANSCRIPT_FILLER_WORDS = new Set([
  "ah",
  "eh",
  "erm",
  "hey",
  "hi",
  "hm",
  "hmm",
  "huh",
  "mhm",
  "mm",
  "uh",
  "uhh",
  "um",
  "umm",
]);

const TRANSCRIPT_SHORT_WORD_ALLOWLIST = new Set(["no", "nope", "ok", "okay", "sure", "yes", "yep"]);

const SINGLE_TOPIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "so",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "us",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const SINGLE_TOPIC_ANCHOR_KEYWORD_LIMIT = 16;

function normalizeTranscriptWord(word: string): string {
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

export function shouldIgnoreTranscriptForResponse(transcript: string): boolean {
  const compact = transcript.trim().replace(/\s+/g, " ");
  if (!compact) {
    return true;
  }

  const tokens = compact.split(" ");
  if (tokens.length !== 1) {
    return false;
  }

  const token = normalizeTranscriptWord(tokens[0] ?? "");
  if (token && TRANSCRIPT_FILLER_WORDS.has(token)) {
    return true;
  }

  if (token && token.length <= 2 && !TRANSCRIPT_SHORT_WORD_ALLOWLIST.has(token)) {
    return true;
  }

  if (!token && compact.length <= 2) {
    return true;
  }

  return false;
}

function normalizeTopicKeyword(word: string): string {
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

export function extractTopicKeywords(transcript: string): string[] {
  const compact = transcript.trim().replace(/\s+/g, " ");
  if (!compact) {
    return [];
  }

  const keywords = compact
    .split(" ")
    .map((word) => normalizeTopicKeyword(word))
    .filter((word) => word.length >= 3)
    .filter((word) => !/^\d+$/.test(word))
    .filter((word) => !SINGLE_TOPIC_STOP_WORDS.has(word));

  return Array.from(new Set(keywords));
}

export function evaluateSingleTopicTranscript(params: {
  transcript: string;
  anchorKeywords: string[];
  minKeywords: number;
}): {
  allow: boolean;
  establishAnchor: boolean;
  transcriptKeywords: string[];
  overlapKeywords: string[];
} {
  const minKeywords = Math.max(1, Math.floor(params.minKeywords || 1));
  const transcriptKeywords = extractTopicKeywords(params.transcript);

  if (transcriptKeywords.length < minKeywords) {
    return {
      allow: true,
      establishAnchor: false,
      transcriptKeywords,
      overlapKeywords: [],
    };
  }

  if (params.anchorKeywords.length === 0) {
    return {
      allow: true,
      establishAnchor: true,
      transcriptKeywords,
      overlapKeywords: [],
    };
  }

  const anchorSet = new Set(params.anchorKeywords);
  const overlapKeywords = transcriptKeywords.filter((keyword) => anchorSet.has(keyword));

  return {
    allow: overlapKeywords.length > 0,
    establishAnchor: false,
    transcriptKeywords,
    overlapKeywords,
  };
}

function mergeTopicKeywords(anchorKeywords: string[], transcriptKeywords: string[]): string[] {
  const merged = [...anchorKeywords];
  const seen = new Set(anchorKeywords);

  for (const keyword of transcriptKeywords) {
    if (seen.has(keyword)) {
      continue;
    }
    merged.push(keyword);
    seen.add(keyword);
    if (merged.length >= SINGLE_TOPIC_ANCHOR_KEYWORD_LIMIT) {
      break;
    }
  }

  return merged;
}

type SingleTopicCallState = {
  anchorKeywords: string[];
  driftCount: number;
};

type PendingVoiceResponseState = {
  generation: number;
  disconnected: boolean;
  settleCues?: () => void;
};

/**
 * HTTP server for receiving voice call webhooks from providers.
 * Supports WebSocket upgrades for media streams when streaming is enabled.
 */
export class VoiceCallWebhookServer {
  private server: http.Server | null = null;
  private config: VoiceCallConfig;
  private manager: CallManager;
  private provider: VoiceCallProvider;
  private coreConfig: CoreConfig | null;

  /** Media stream handler for bidirectional audio (when streaming enabled) */
  private mediaStreamHandler: MediaStreamHandler | null = null;

  /** Tracks in-flight response generations so stale/disconnected replies can be dropped. */
  private pendingResponses = new Map<string, PendingVoiceResponseState>();

  /** Tracks per-call topic anchors for optional single-topic filtering. */
  private singleTopicStates = new Map<string, SingleTopicCallState>();

  constructor(
    config: VoiceCallConfig,
    manager: CallManager,
    provider: VoiceCallProvider,
    coreConfig?: CoreConfig,
  ) {
    this.config = config;
    this.manager = manager;
    this.provider = provider;
    this.coreConfig = coreConfig ?? null;

    // Initialize media stream handler if streaming is enabled
    if (config.streaming?.enabled) {
      this.initializeMediaStreaming();
    }
  }

  /**
   * Get the media stream handler (for wiring to provider).
   */
  getMediaStreamHandler(): MediaStreamHandler | null {
    return this.mediaStreamHandler;
  }

  /**
   * Initialize media streaming with OpenAI Realtime STT.
   */
  private initializeMediaStreaming(): void {
    const apiKey = this.config.streaming?.openaiApiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.warn("[voice-call] Streaming enabled but no OpenAI API key found");
      return;
    }

    const sttProvider = new OpenAIRealtimeSTTProvider({
      apiKey,
      model: this.config.streaming?.sttModel,
      silenceDurationMs: this.config.streaming?.silenceDurationMs,
      vadThreshold: this.config.streaming?.vadThreshold,
    });

    const streamConfig: MediaStreamConfig = {
      sttProvider,
      shouldAcceptStream: ({ callId, token }) => {
        const call = this.manager.getCallByProviderCallId(callId);
        if (!call) {
          console.warn(`[voice-call] Rejecting media stream: no call record for ${callId}`);
          return false;
        }
        if (this.provider.name === "twilio") {
          const twilio = this.provider as TwilioProvider;
          console.log(
            `[voice-call] Stream auth check: callId=${callId}, hasToken=${!!token}, tokenLen=${token?.length ?? 0}`,
          );
          if (!twilio.isValidStreamToken(callId, token)) {
            console.warn(`[voice-call] Rejecting media stream: invalid token for ${callId}`);
            return false;
          }
        }
        return true;
      },
      onTranscript: (providerCallId, transcript) => {
        console.log(`[voice-call] Transcript for ${providerCallId}: ${transcript}`);

        // Clear TTS queue on barge-in (user started speaking, interrupt current playback)
        if (this.provider.name === "twilio") {
          (this.provider as TwilioProvider).clearTtsQueue(providerCallId);
        }

        // Look up our internal call ID from the provider call ID
        const call = this.manager.getCallByProviderCallId(providerCallId);
        if (!call) {
          console.warn(`[voice-call] No active call found for provider ID: ${providerCallId}`);
          return;
        }

        // Create a speech event and process it through the manager
        const event: NormalizedEvent = {
          id: `stream-transcript-${Date.now()}`,
          type: "call.speech",
          callId: call.callId,
          providerCallId,
          timestamp: Date.now(),
          transcript,
          isFinal: true,
        };
        this.manager.processEvent(event);

        // Auto-respond in conversation mode (inbound always, outbound if mode is conversation)
        const callMode = call.metadata?.mode as string | undefined;
        const shouldRespond = call.direction === "inbound" || callMode === "conversation";
        if (!shouldRespond) {
          return;
        }

        if (shouldIgnoreTranscriptForResponse(transcript)) {
          console.log(
            `[voice-call] Ignoring short/filler transcript for ${call.callId}: "${transcript}"`,
          );
          return;
        }

        void (async () => {
          const allowResponse = await this.shouldAutoRespondToTranscript(call.callId, transcript);
          if (!allowResponse) {
            return;
          }

          await this.handleInboundResponse(call.callId, transcript);
        })().catch((err) => {
          console.warn(`[voice-call] Failed to auto-respond:`, err);
        });
      },
      onSpeechStart: (providerCallId) => {
        if (this.provider.name === "twilio") {
          (this.provider as TwilioProvider).clearTtsQueue(providerCallId);
        }
      },
      onPartialTranscript: (callId, partial) => {
        console.log(`[voice-call] Partial for ${callId}: ${partial}`);
      },
      onConnect: (callId, streamSid) => {
        console.log(`[voice-call] Media stream connected: ${callId} -> ${streamSid}`);
        // Register stream with provider for TTS routing
        if (this.provider.name === "twilio") {
          (this.provider as TwilioProvider).registerCallStream(callId, streamSid);
        }

        // Speak initial message if one was provided when call was initiated
        // Use setTimeout to allow stream setup to complete
        setTimeout(() => {
          this.manager.speakInitialMessage(callId).catch((err) => {
            console.warn(`[voice-call] Failed to speak initial message:`, err);
          });
        }, 500);
      },
      onDisconnect: (providerCallId) => {
        console.log(`[voice-call] Media stream disconnected: ${providerCallId}`);
        const call = this.manager.getCallByProviderCallId(providerCallId);
        if (call) {
          this.markResponseDisconnected(call.callId);
          this.clearSingleTopicState(call.callId);
        }
        if (this.provider.name === "twilio") {
          (this.provider as TwilioProvider).unregisterCallStream(providerCallId);
        }
      },
    };

    this.mediaStreamHandler = new MediaStreamHandler(streamConfig);
    console.log("[voice-call] Media streaming initialized");
  }

  /**
   * Start the webhook server.
   */
  async start(): Promise<string> {
    const { port, bind, path: webhookPath } = this.config.serve;
    const streamPath = this.config.streaming?.streamPath || "/voice/stream";

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res, webhookPath).catch((err) => {
          console.error("[voice-call] Webhook error:", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        });
      });

      // Handle WebSocket upgrades for media streams
      if (this.mediaStreamHandler) {
        this.server.on("upgrade", (request, socket, head) => {
          const url = new URL(request.url || "/", `http://${request.headers.host}`);

          if (url.pathname === streamPath) {
            console.log(`[voice-call] WebSocket upgrade for media stream, url=${request.url}`);
            this.mediaStreamHandler?.handleUpgrade(request, socket, head);
          } else {
            socket.destroy();
          }
        });
      }

      this.server.on("error", reject);

      this.server.listen(port, bind, () => {
        const url = `http://${bind}:${port}${webhookPath}`;
        console.log(`[voice-call] Webhook server listening on ${url}`);
        if (this.mediaStreamHandler) {
          console.log(`[voice-call] Media stream WebSocket on ws://${bind}:${port}${streamPath}`);
        }
        resolve(url);
      });
    });
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming HTTP request.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    webhookPath: string,
  ): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // Check path
    if (!url.pathname.startsWith(webhookPath)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    // Only accept POST
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    // Read body
    let body = "";
    try {
      body = await this.readBody(req, MAX_WEBHOOK_BODY_BYTES);
    } catch (err) {
      if (isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE")) {
        res.statusCode = 413;
        res.end("Payload Too Large");
        return;
      }
      if (isRequestBodyLimitError(err, "REQUEST_BODY_TIMEOUT")) {
        res.statusCode = 408;
        res.end(requestBodyErrorToText("REQUEST_BODY_TIMEOUT"));
        return;
      }
      throw err;
    }

    // Build webhook context
    const ctx: WebhookContext = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody: body,
      url: `http://${req.headers.host}${req.url}`,
      method: "POST",
      query: Object.fromEntries(url.searchParams),
      remoteAddress: req.socket.remoteAddress ?? undefined,
    };

    // Verify signature
    const verification = this.provider.verifyWebhook(ctx);
    if (!verification.ok) {
      console.warn(`[voice-call] Webhook verification failed: ${verification.reason}`);
      res.statusCode = 401;
      res.end("Unauthorized");
      return;
    }

    // Parse events
    const result = this.provider.parseWebhookEvent(ctx);

    // Process each event
    for (const event of result.events) {
      const callBeforeEvent =
        (event.providerCallId
          ? this.manager.getCallByProviderCallId(event.providerCallId)
          : undefined) ?? this.manager.getCall(event.callId);

      try {
        this.manager.processEvent(event);
      } catch (err) {
        console.error(`[voice-call] Error processing event ${event.type}:`, err);
      }

      if (event.type === "call.ended" || (event.type === "call.error" && !event.retryable)) {
        const terminalCallId = callBeforeEvent?.callId ?? event.callId;
        this.markResponseDisconnected(terminalCallId);
        this.clearSingleTopicState(terminalCallId);
      }
    }

    // Send response
    res.statusCode = result.statusCode || 200;

    if (result.providerResponseHeaders) {
      for (const [key, value] of Object.entries(result.providerResponseHeaders)) {
        res.setHeader(key, value);
      }
    }

    res.end(result.providerResponseBody || "OK");
  }

  /**
   * Read request body as string with timeout protection.
   */
  private readBody(
    req: http.IncomingMessage,
    maxBytes: number,
    timeoutMs = 30_000,
  ): Promise<string> {
    return readRequestBodyWithLimit(req, { maxBytes, timeoutMs });
  }

  private beginVoiceResponseGeneration(callId: string): number {
    const existing = this.pendingResponses.get(callId);
    if (existing?.settleCues) {
      existing.settleCues();
    }

    const generation = (existing?.generation ?? 0) + 1;
    this.pendingResponses.set(callId, {
      generation,
      disconnected: false,
    });
    return generation;
  }

  private registerCueController(callId: string, generation: number, settle: () => void): void {
    const state = this.pendingResponses.get(callId);
    if (!state || state.disconnected || state.generation !== generation) {
      settle();
      return;
    }

    state.settleCues = settle;
    this.pendingResponses.set(callId, state);
  }

  private clearCueController(callId: string, generation: number): void {
    const state = this.pendingResponses.get(callId);
    if (!state || state.generation !== generation) {
      return;
    }

    state.settleCues = undefined;
    this.pendingResponses.set(callId, state);
  }

  private markResponseDisconnected(callId: string): void {
    const state = this.pendingResponses.get(callId);
    if (!state) {
      return;
    }

    if (state.settleCues) {
      state.settleCues();
    }

    this.pendingResponses.set(callId, {
      generation: state.generation + 1,
      disconnected: true,
    });
  }

  private isVoiceResponseGenerationCurrent(callId: string, generation: number): boolean {
    const state = this.pendingResponses.get(callId);
    return Boolean(state) && !state!.disconnected && state!.generation === generation;
  }

  private async speakResponseCue(params: {
    callId: string;
    kind: VoiceCallResponseCueKind;
    text: string;
  }): Promise<void> {
    const speakResult = await this.manager.speak(params.callId, params.text, {
      recordTranscript: false,
    });
    if (!speakResult.success) {
      console.warn(
        `[voice-call] Failed to speak ${params.kind} cue for ${params.callId}: ${speakResult.error ?? "unknown error"}`,
      );
    }
  }

  private clearSingleTopicState(callId: string): void {
    this.singleTopicStates.delete(callId);
  }

  private async shouldAutoRespondToTranscript(
    callId: string,
    transcript: string,
  ): Promise<boolean> {
    const singleTopic = this.config.singleTopic;
    if (!singleTopic?.enabled) {
      return true;
    }

    const existing = this.singleTopicStates.get(callId) ?? {
      anchorKeywords: [],
      driftCount: 0,
    };

    const decision = evaluateSingleTopicTranscript({
      transcript,
      anchorKeywords: existing.anchorKeywords,
      minKeywords: singleTopic.minKeywords,
    });

    if (decision.establishAnchor || decision.allow) {
      const anchorKeywords = mergeTopicKeywords(
        existing.anchorKeywords,
        decision.transcriptKeywords,
      );
      this.singleTopicStates.set(callId, {
        anchorKeywords,
        driftCount: 0,
      });

      if (decision.establishAnchor && anchorKeywords.length > 0) {
        console.log(
          "[voice-call] Single-topic anchor set for " + callId + ": " + anchorKeywords.join(", "),
        );
      }

      return true;
    }

    const driftCount = existing.driftCount + 1;
    this.singleTopicStates.set(callId, {
      anchorKeywords: existing.anchorKeywords,
      driftCount,
    });

    console.log(
      "[voice-call] Single-topic drift detected for " +
        callId +
        "; anchor=[" +
        existing.anchorKeywords.join(", ") +
        "], transcript=[" +
        decision.transcriptKeywords.join(", ") +
        "], count=" +
        driftCount,
    );

    const warningMessage =
      typeof singleTopic.warningMessage === "string" ? singleTopic.warningMessage.trim() : "";
    if (warningMessage.length > 0) {
      const warningResult = await this.manager.speak(callId, warningMessage, {
        recordTranscript: false,
      });
      if (!warningResult.success) {
        console.warn(
          "[voice-call] Failed to speak single-topic warning for " +
            callId +
            ": " +
            (warningResult.error ?? "unknown error"),
        );
      }
    }

    if (singleTopic.endCallOnDrift && driftCount >= singleTopic.maxDriftCount) {
      console.log("[voice-call] Ending " + callId + " after repeated topic drift");
      const endResult = await this.manager.endCall(callId);
      if (!endResult.success) {
        console.warn(
          "[voice-call] Failed to end " +
            callId +
            " after topic drift: " +
            (endResult.error ?? "unknown error"),
        );
      }
      this.markResponseDisconnected(callId);
      this.clearSingleTopicState(callId);
    }

    return false;
  }

  /**
   * Handle auto-response for inbound calls using the agent system.
   * Supports tool calling for richer voice interactions.
   */
  private async handleInboundResponse(callId: string, userMessage: string): Promise<void> {
    console.log(`[voice-call] Auto-responding to inbound call ${callId}: "${userMessage}"`);

    // Get call context for conversation history
    const call = this.manager.getCall(callId);
    if (!call) {
      console.warn(`[voice-call] Call ${callId} not found for auto-response`);
      return;
    }

    if (!this.coreConfig) {
      console.warn("[voice-call] Core config missing; skipping auto-response");
      return;
    }

    // Every new transcript supersedes prior in-flight generations for this call.
    const generation = this.beginVoiceResponseGeneration(callId);

    const cuePlan = resolveVoiceCallResponseCuePlan(this.config.responseCues);
    const cues = createVoiceCallResponseCueController({
      plan: cuePlan,
      speak: async (cue) => {
        await this.speakResponseCue({
          callId,
          kind: cue.kind,
          text: cue.text,
        });
      },
    });
    this.registerCueController(callId, generation, () => {
      cues.settle();
    });

    try {
      const { generateVoiceResponse } = await import("./response-generator.js");

      const responsePromise = generateVoiceResponse({
        voiceConfig: this.config,
        coreConfig: this.coreConfig,
        callId,
        from: call.from,
        transcript: call.transcript,
        userMessage,
      });

      if (!this.isVoiceResponseGenerationCurrent(callId, generation)) {
        return;
      }

      await cues.maybeSpeakAcknowledgement();
      if (!this.isVoiceResponseGenerationCurrent(callId, generation)) {
        return;
      }

      cues.scheduleProgressCue();

      const result = await responsePromise;
      if (!this.isVoiceResponseGenerationCurrent(callId, generation)) {
        console.log(`[voice-call] Dropping stale voice response for ${callId}`);
        return;
      }

      if (result.error) {
        console.error(`[voice-call] Response generation error: ${result.error}`);
        return;
      }

      if (result.text) {
        const speakResult = await this.manager.speak(callId, result.text);
        if (!speakResult.success) {
          console.warn(
            `[voice-call] Failed to speak AI response for ${callId}: ${speakResult.error ?? "unknown error"}`,
          );
          return;
        }

        console.log(`[voice-call] AI response: "${result.text}"`);
      }
    } catch (err) {
      console.error(`[voice-call] Auto-response error:`, err);
    } finally {
      this.clearCueController(callId, generation);
      cues.settle();
    }
  }
}

/**
 * Resolve the current machine's Tailscale DNS name.
 */
export type TailscaleSelfInfo = {
  dnsName: string | null;
  nodeId: string | null;
};

/**
 * Run a tailscale command with timeout, collecting stdout.
 */
function runTailscaleCommand(
  args: string[],
  timeoutMs = 2500,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn("tailscale", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (data) => {
      stdout += data;
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ code: -1, stdout: "" });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout });
    });
  });
}

export async function getTailscaleSelfInfo(): Promise<TailscaleSelfInfo | null> {
  const { code, stdout } = await runTailscaleCommand(["status", "--json"]);
  if (code !== 0) {
    return null;
  }

  try {
    const status = JSON.parse(stdout);
    return {
      dnsName: status.Self?.DNSName?.replace(/\.$/, "") || null,
      nodeId: status.Self?.ID || null,
    };
  } catch {
    return null;
  }
}

export async function getTailscaleDnsName(): Promise<string | null> {
  const info = await getTailscaleSelfInfo();
  return info?.dnsName ?? null;
}

export async function setupTailscaleExposureRoute(opts: {
  mode: "serve" | "funnel";
  path: string;
  localUrl: string;
}): Promise<string | null> {
  const dnsName = await getTailscaleDnsName();
  if (!dnsName) {
    console.warn("[voice-call] Could not get Tailscale DNS name");
    return null;
  }

  const { code } = await runTailscaleCommand([
    opts.mode,
    "--bg",
    "--yes",
    "--set-path",
    opts.path,
    opts.localUrl,
  ]);

  if (code === 0) {
    const publicUrl = `https://${dnsName}${opts.path}`;
    console.log(`[voice-call] Tailscale ${opts.mode} active: ${publicUrl}`);
    return publicUrl;
  }

  console.warn(`[voice-call] Tailscale ${opts.mode} failed`);
  return null;
}

export async function cleanupTailscaleExposureRoute(opts: {
  mode: "serve" | "funnel";
  path: string;
}): Promise<void> {
  await runTailscaleCommand([opts.mode, "off", opts.path]);
}

/**
 * Setup Tailscale serve/funnel for the webhook server.
 * This is a helper that shells out to `tailscale serve` or `tailscale funnel`.
 */
export async function setupTailscaleExposure(config: VoiceCallConfig): Promise<string | null> {
  if (config.tailscale.mode === "off") {
    return null;
  }

  const mode = config.tailscale.mode === "funnel" ? "funnel" : "serve";
  // Include the path suffix so tailscale forwards to the correct endpoint
  // (tailscale strips the mount path prefix when proxying)
  const localUrl = `http://127.0.0.1:${config.serve.port}${config.serve.path}`;
  return setupTailscaleExposureRoute({
    mode,
    path: config.tailscale.path,
    localUrl,
  });
}

/**
 * Cleanup Tailscale serve/funnel.
 */
export async function cleanupTailscaleExposure(config: VoiceCallConfig): Promise<void> {
  if (config.tailscale.mode === "off") {
    return;
  }

  const mode = config.tailscale.mode === "funnel" ? "funnel" : "serve";
  await cleanupTailscaleExposureRoute({ mode, path: config.tailscale.path });
}
