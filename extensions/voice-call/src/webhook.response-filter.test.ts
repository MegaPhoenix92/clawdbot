import { describe, expect, it } from "vitest";
import {
  evaluateSingleTopicTranscript,
  extractTopicKeywords,
  shouldIgnoreTranscriptForResponse,
} from "./webhook.js";

describe("shouldIgnoreTranscriptForResponse", () => {
  it("ignores empty/whitespace transcripts", () => {
    expect(shouldIgnoreTranscriptForResponse("")).toBe(true);
    expect(shouldIgnoreTranscriptForResponse("   ")).toBe(true);
  });

  it("ignores common filler words", () => {
    expect(shouldIgnoreTranscriptForResponse("um")).toBe(true);
    expect(shouldIgnoreTranscriptForResponse("Uh")).toBe(true);
    expect(shouldIgnoreTranscriptForResponse("hmm")).toBe(true);
    expect(shouldIgnoreTranscriptForResponse("umm...")).toBe(true);
  });

  it("ignores one-token noise of length <= 2 that is not allowlisted", () => {
    expect(shouldIgnoreTranscriptForResponse("a")).toBe(true);
    expect(shouldIgnoreTranscriptForResponse("k")).toBe(true);
    expect(shouldIgnoreTranscriptForResponse("yo")).toBe(true);
    expect(shouldIgnoreTranscriptForResponse("..")).toBe(true);
  });

  it("keeps short but valid allowlisted acknowledgements", () => {
    expect(shouldIgnoreTranscriptForResponse("ok")).toBe(false);
    expect(shouldIgnoreTranscriptForResponse("okay")).toBe(false);
    expect(shouldIgnoreTranscriptForResponse("yes")).toBe(false);
    expect(shouldIgnoreTranscriptForResponse("no")).toBe(false);
  });

  it("keeps multi-word transcripts", () => {
    expect(shouldIgnoreTranscriptForResponse("what is kwanzaa")).toBe(false);
    expect(shouldIgnoreTranscriptForResponse("yes please")).toBe(false);
  });
});

describe("extractTopicKeywords", () => {
  it("extracts normalized topic-bearing words", () => {
    expect(extractTopicKeywords("Need weather forecast for San Francisco tomorrow")).toEqual([
      "need",
      "weather",
      "forecast",
      "san",
      "francisco",
      "tomorrow",
    ]);
  });

  it("drops stop-words and numeric tokens", () => {
    expect(extractTopicKeywords("what is the code 483920 for my account")).toEqual([
      "code",
      "account",
    ]);
  });
});

describe("evaluateSingleTopicTranscript", () => {
  it("establishes topic anchor when none exists", () => {
    const result = evaluateSingleTopicTranscript({
      transcript: "Need help with my gym class schedule",
      anchorKeywords: [],
      minKeywords: 2,
    });

    expect(result).toEqual({
      allow: true,
      establishAnchor: true,
      transcriptKeywords: ["need", "help", "gym", "class", "schedule"],
      overlapKeywords: [],
    });
  });

  it("allows related follow-ups when keywords overlap", () => {
    const result = evaluateSingleTopicTranscript({
      transcript: "What gym class times are open tonight",
      anchorKeywords: ["gym", "class", "schedule"],
      minKeywords: 2,
    });

    expect(result.allow).toBe(true);
    expect(result.establishAnchor).toBe(false);
    expect(result.overlapKeywords).toEqual(["gym", "class"]);
  });

  it("flags unrelated pivots as drift", () => {
    const result = evaluateSingleTopicTranscript({
      transcript: "Book me a dentist appointment tomorrow",
      anchorKeywords: ["gym", "class", "schedule"],
      minKeywords: 2,
    });

    expect(result.allow).toBe(false);
    expect(result.establishAnchor).toBe(false);
    expect(result.overlapKeywords).toEqual([]);
    expect(result.transcriptKeywords).toEqual(["book", "dentist", "appointment", "tomorrow"]);
  });

  it("does not drift on short confirmations", () => {
    const result = evaluateSingleTopicTranscript({
      transcript: "yes",
      anchorKeywords: ["weather", "forecast"],
      minKeywords: 2,
    });

    expect(result.allow).toBe(true);
    expect(result.establishAnchor).toBe(false);
  });
});
