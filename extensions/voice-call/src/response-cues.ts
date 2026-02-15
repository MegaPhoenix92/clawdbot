import type { VoiceCallResponseCuesConfig } from "./config.js";

export type VoiceCallResponseCueKind = "acknowledgement" | "progress";

export type VoiceCallResponseCuePlan = {
  enabled: boolean;
  acknowledgement: string | null;
  progress: string | null;
  progressDelayMs: number;
};

const DEFAULT_ACKNOWLEDGEMENT = "Got it, checking now.";
const DEFAULT_PROGRESS = "Still working on that.";
const DEFAULT_PROGRESS_DELAY_MS = 6000;

function normalizeCueText(raw: string | undefined, fallback: string): string | null {
  if (raw === undefined) {
    return fallback;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveVoiceCallResponseCuePlan(
  config: VoiceCallResponseCuesConfig | undefined,
): VoiceCallResponseCuePlan {
  const enabled = config?.enabled === true;
  const acknowledgement = normalizeCueText(config?.acknowledgement, DEFAULT_ACKNOWLEDGEMENT);
  const progress = normalizeCueText(config?.progress, DEFAULT_PROGRESS);
  const progressDelayMs =
    typeof config?.progressDelayMs === "number" && Number.isFinite(config.progressDelayMs)
      ? Math.max(0, Math.floor(config.progressDelayMs))
      : DEFAULT_PROGRESS_DELAY_MS;

  if (!enabled) {
    return {
      enabled: false,
      acknowledgement: null,
      progress: null,
      progressDelayMs,
    };
  }

  return {
    enabled,
    acknowledgement,
    progress,
    progressDelayMs,
  };
}

type TimerHandle = ReturnType<typeof setTimeout>;

export function createVoiceCallResponseCueController(params: {
  plan: VoiceCallResponseCuePlan;
  speak: (cue: { kind: VoiceCallResponseCueKind; text: string }) => Promise<void>;
  setTimeoutImpl?: (callback: () => void, ms: number) => TimerHandle;
  clearTimeoutImpl?: (id: TimerHandle) => void;
}): {
  maybeSpeakAcknowledgement: () => Promise<void>;
  scheduleProgressCue: () => void;
  settle: () => void;
} {
  const { plan, speak } = params;
  const setTimeoutImpl = params.setTimeoutImpl ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimeoutImpl = params.clearTimeoutImpl ?? ((id) => clearTimeout(id));

  let settled = false;
  let progressTimer: TimerHandle | null = null;

  const maybeSpeakAcknowledgement = async (): Promise<void> => {
    if (!plan.enabled || !plan.acknowledgement || settled) {
      return;
    }
    await speak({ kind: "acknowledgement", text: plan.acknowledgement });
  };

  const scheduleProgressCue = (): void => {
    if (!plan.enabled || !plan.progress || settled || progressTimer) {
      return;
    }

    progressTimer = setTimeoutImpl(() => {
      if (settled || !plan.progress) {
        return;
      }
      void speak({ kind: "progress", text: plan.progress });
    }, plan.progressDelayMs);
  };

  const settle = (): void => {
    settled = true;
    if (progressTimer) {
      clearTimeoutImpl(progressTimer);
      progressTimer = null;
    }
  };

  return {
    maybeSpeakAcknowledgement,
    scheduleProgressCue,
    settle,
  };
}
