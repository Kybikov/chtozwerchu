import { describe, expect, it } from "vitest";
import { cueAudioRange } from "./cueAudio";

describe("line audition against the real audio", () => {
  const cue = { startMs: 3912, endMs: 5087, text: "Власний тестовий рядок" };
  it("uses the calibrated audio clock, including negative offsets", () => {
    expect(cueAudioRange(cue, 175, 30)).toEqual({ start: 3.737, end: 4.912 });
    expect(cueAudioRange(cue, -1000, 30)).toEqual({ start: 4.912, end: 6.087 });
    expect(cueAudioRange(cue, 3912, 1.175)).toEqual({ start: 0, end: 1.175 });
  });
  it("rejects lines outside the fragment instead of playing another part", () => {
    expect(cueAudioRange(cue, 4000, 30)).toBeNull();
    expect(cueAudioRange(cue, 0, 5)).toBeNull();
    expect(cueAudioRange(cue, NaN, 30)).toBeNull();
    expect(cueAudioRange(cue, 0, Infinity)).toBeNull();
  });
});
