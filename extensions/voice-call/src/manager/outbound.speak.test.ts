import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceCallConfigSchema } from "../config.js";
import { speak } from "./outbound.js";

class FakeProvider {
  readonly name = "twilio" as const;
  readonly playTtsCalls: Array<Record<string, unknown>> = [];

  verifyWebhook() {
    return { ok: true } as const;
  }
  parseWebhookEvent() {
    return { events: [], statusCode: 200 };
  }
  async initiateCall() {
    return { providerCallId: "provider-call-1", status: "initiated" as const };
  }
  async hangupCall() {}
  async playTts(input: unknown) {
    this.playTtsCalls.push(input as Record<string, unknown>);
  }
  async startListening() {}
  async stopListening() {}
}

function makeSpeakContext(params: {
  provider: FakeProvider;
  storePath: string;
  transcript: Array<{ timestamp: number; speaker: "bot" | "user"; text: string; isFinal: boolean }>;
}) {
  const config = VoiceCallConfigSchema.parse({
    enabled: true,
    provider: "twilio",
    fromNumber: "+15550001234",
  });

  const call = {
    callId: "call-1",
    providerCallId: "provider-call-1",
    provider: "twilio" as const,
    direction: "inbound" as const,
    state: "active" as const,
    from: "+15550001111",
    to: "+15550001234",
    startedAt: Date.now(),
    transcript: params.transcript,
    processedEventIds: [],
  };

  return {
    activeCalls: new Map([["call-1", call]]),
    providerCallIdMap: new Map([["provider-call-1", "call-1"]]),
    provider: params.provider,
    config,
    storePath: params.storePath,
  };
}

describe("manager/outbound speak", () => {
  it("does not persist transcript entries when recordTranscript=false", async () => {
    const storePath = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-voice-speak-"));
    const provider = new FakeProvider();
    const ctx = makeSpeakContext({ provider, storePath, transcript: [] });

    const result = await speak(ctx, "call-1", "Got it, checking now.", {
      recordTranscript: false,
    });

    expect(result.success).toBe(true);
    expect(ctx.activeCalls.get("call-1")?.transcript).toHaveLength(0);
    expect(provider.playTtsCalls).toHaveLength(1);
  });

  it("persists transcript entries by default", async () => {
    const storePath = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-voice-speak-"));
    const provider = new FakeProvider();
    const ctx = makeSpeakContext({ provider, storePath, transcript: [] });

    const result = await speak(ctx, "call-1", "Final answer");

    expect(result.success).toBe(true);
    expect(ctx.activeCalls.get("call-1")?.transcript).toHaveLength(1);
    expect(ctx.activeCalls.get("call-1")?.transcript[0]?.text).toBe("Final answer");
    expect(provider.playTtsCalls).toHaveLength(1);
  });
});
