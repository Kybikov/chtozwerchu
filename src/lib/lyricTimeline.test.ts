import { describe, expect, it } from "vitest";
import { sameCueTimeline, wordCoverage } from "./lyricTimeline";
import type { Cue } from "./music";

const line: Cue = {
  startMs: 3912,
  endMs: 5087,
  text: "Лови цей ритм",
  words: [
    { startMs: 3912, endMs: 3925, text: "Лови " },
    { startMs: 4050, endMs: 4287, text: "цей " },
    { startMs: 4387, endMs: 5087, text: "ритм" },
  ],
};
describe("provider lyric timeline", () => {
  it("invalidates an old line calibration when finer provider timing moves a line, but keeps it when only words are added", () => {
    const coarse = { ...line, startMs: 0, endMs: 3540, words: undefined };
    expect(sameCueTimeline([coarse], [line])).toBe(false);
    expect(sameCueTimeline([{ ...line, words: undefined }], [line])).toBe(true);
    expect(sameCueTimeline(undefined, [line])).toBe(false);
    expect(sameCueTimeline([line], [{ ...line, text: "Інший текст" }])).toBe(
      false,
    );
  });
  it("reports actual validated coverage without manufacturing word timing for the remaining lines", () => {
    const untimed = { startMs: 6000, endMs: 8000, text: "Інший рядок" };
    expect(wordCoverage([line, untimed])).toEqual({
      lines: 1,
      words: 3,
      total: 2,
    });
    expect(
      wordCoverage([{ ...line, words: [{ ...line.words![0], endMs: 6000 }] }]),
    ).toEqual({ lines: 0, words: 0, total: 1 });
  });
});
