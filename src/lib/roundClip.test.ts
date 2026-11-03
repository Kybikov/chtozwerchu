import { describe, expect, it } from "vitest";
import { clipLength, roundClip } from "./roundClip";

describe("round excerpts", () => {
  const answer = {
    startMs: 20500,
    endMs: 24000,
    text: "Прихований власний рядок",
  };
  it("ends exactly at the calibrated answer with the chosen lead-in", () => {
    expect(roundClip(answer, 500, 30, 5)).toEqual({
      start: 15,
      end: 20,
      seconds: 5,
    });
    expect(roundClip(answer, 500, 30, 15)).toEqual({
      start: 5,
      end: 20,
      seconds: 15,
    });
    expect(roundClip(answer, -500, 30, 10)).toEqual({
      start: 11,
      end: 21,
      seconds: 10,
    });
  });
  it("keeps legacy preparations at seven seconds and reports the real shorter fragment at the beginning", () => {
    expect(clipLength(undefined)).toBe(7);
    expect(clipLength(0)).toBe(7);
    expect(clipLength(6)).toBe(7);
    expect(roundClip(answer, 0, 30, undefined)?.start).toBe(13.5);
    expect(roundClip({ ...answer, startMs: 3000 }, 500, 30, 15)).toEqual({
      start: 0,
      end: 2.5,
      seconds: 2.5,
    });
  });
  it("rejects a cutoff outside the real audio", () => {
    expect(roundClip(answer, 0, 10, 5)).toBeNull();
    expect(roundClip(answer, 20500, 30, 5)).toBeNull();
    expect(roundClip(undefined, 0, 30, 5)).toBeNull();
    expect(roundClip(answer, NaN, 30, 5)).toBeNull();
  });
});
