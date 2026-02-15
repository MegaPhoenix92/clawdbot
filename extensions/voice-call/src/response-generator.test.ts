import { describe, expect, it } from "vitest";
import { clampVoiceResponseText } from "./response-generator.js";

describe("clampVoiceResponseText", () => {
  it("keeps only the first sentence", () => {
    const input = "**Hello there.** This should not be spoken on phone.";
    expect(clampVoiceResponseText(input)).toBe("Hello there.");
  });

  it("strips markdown links and inline code", () => {
    const input = "Check [`docs`](https://example.com) now. `debug` mode is on.";
    expect(clampVoiceResponseText(input)).toBe("Check docs now.");
  });

  it("truncates long responses to max words", () => {
    const input =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.";
    expect(clampVoiceResponseText(input, 10)).toBe(
      "one two three four five six seven eight nine ten...",
    );
  });

  it("returns empty string for empty content", () => {
    expect(clampVoiceResponseText("   \n\t  ")).toBe("");
  });
});
