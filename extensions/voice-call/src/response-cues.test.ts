import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceCallResponseCueController,
  resolveVoiceCallResponseCuePlan,
  type VoiceCallResponseCuePlan,
} from "./response-cues.js";

describe("resolveVoiceCallResponseCuePlan", () => {
  it("returns disabled/null cues when not enabled", () => {
    const plan = resolveVoiceCallResponseCuePlan({
      enabled: false,
      acknowledgement: "Ack",
      progress: "Progress",
      progressDelayMs: 2000,
    });

    expect(plan).toEqual({
      enabled: false,
      acknowledgement: null,
      progress: null,
      progressDelayMs: 2000,
    });
  });

  it("uses defaults when enabled with missing text values", () => {
    const plan = resolveVoiceCallResponseCuePlan({
      enabled: true,
      acknowledgement: undefined,
      progress: undefined,
      progressDelayMs: 6000,
    });

    expect(plan).toEqual({
      enabled: true,
      acknowledgement: "Got it, checking now.",
      progress: "Still working on that.",
      progressDelayMs: 6000,
    });
  });

  it("allows disabling individual cues via empty strings", () => {
    const plan = resolveVoiceCallResponseCuePlan({
      enabled: true,
      acknowledgement: "",
      progress: "   ",
      progressDelayMs: 6000,
    });

    expect(plan).toEqual({
      enabled: true,
      acknowledgement: null,
      progress: null,
      progressDelayMs: 6000,
    });
  });
});

describe("createVoiceCallResponseCueController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPlan(partial?: Partial<VoiceCallResponseCuePlan>): VoiceCallResponseCuePlan {
    return {
      enabled: true,
      acknowledgement: "Got it, checking now.",
      progress: "Still working on that.",
      progressDelayMs: 1500,
      ...partial,
    };
  }

  it("speaks acknowledgement and delayed progress", async () => {
    const spoken: Array<{ kind: string; text: string }> = [];
    const controller = createVoiceCallResponseCueController({
      plan: createPlan(),
      speak: async (cue) => {
        spoken.push(cue);
      },
    });

    await controller.maybeSpeakAcknowledgement();
    expect(spoken).toEqual([{ kind: "acknowledgement", text: "Got it, checking now." }]);

    controller.scheduleProgressCue();
    await vi.advanceTimersByTimeAsync(1499);
    expect(spoken).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(spoken).toHaveLength(2);
    expect(spoken[1]).toEqual({ kind: "progress", text: "Still working on that." });
  });

  it("does not emit progress once settled", async () => {
    const spoken: Array<{ kind: string; text: string }> = [];
    const controller = createVoiceCallResponseCueController({
      plan: createPlan({ progressDelayMs: 1000 }),
      speak: async (cue) => {
        spoken.push(cue);
      },
    });

    controller.scheduleProgressCue();
    controller.settle();
    await vi.advanceTimersByTimeAsync(1000);

    expect(spoken).toEqual([]);
  });

  it("skips acknowledgement when disabled", async () => {
    const spoken: Array<{ kind: string; text: string }> = [];
    const controller = createVoiceCallResponseCueController({
      plan: createPlan({ enabled: false }),
      speak: async (cue) => {
        spoken.push(cue);
      },
    });

    await controller.maybeSpeakAcknowledgement();
    controller.scheduleProgressCue();
    await vi.advanceTimersByTimeAsync(2000);

    expect(spoken).toEqual([]);
  });
});
