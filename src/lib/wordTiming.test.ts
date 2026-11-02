import { describe, expect, it } from "vitest";
import { parseLRC, type Cue } from "./music";
import {
  recordedWords,
  serializeLyrics,
  shiftWordStart,
  validWordTiming,
} from "./wordTiming";

const cue: Cue = { startMs: 1000, endMs: 5000, text: "Лови цей ритм" };
describe("word timing", () => {
  it("keeps captured audio positions, including uneven syllable lengths", () => {
    const words = recordedWords(cue, [1153, 1789, 3234], 4021)!;
    expect(words).toEqual([
      { startMs: 1153, endMs: 1789, text: "Лови " },
      { startMs: 1789, endMs: 3234, text: "цей " },
      { startMs: 3234, endMs: 4021, text: "ритм" },
    ]);
    expect(recordedWords(cue, [1153, 1789], 4021)).toBeNull();
    expect(recordedWords(cue, [999, 1789, 3234], 4021)).toBeNull();
    expect(recordedWords(cue, [1153, 1153, 3234], 4021)).toBeNull();
    expect(recordedWords(cue, [1153, 1789, 3234], 5001)).toBeNull();
  });
  it("adjusts shared boundaries without flattening intentional gaps", () => {
    const words = recordedWords(cue, [1153, 1789, 3234], 4021)!;
    expect(shiftWordStart(cue, words, 1, 50)?.slice(0, 2)).toEqual([
      { startMs: 1153, endMs: 1839, text: "Лови " },
      { startMs: 1839, endMs: 3234, text: "цей " },
    ]);
    expect(shiftWordStart(cue, words, 1, -700)).toBeNull();
    words[0].endMs = 1500;
    expect(shiftWordStart(cue, words, 1, -50)?.[0].endMs).toBe(1500);
    expect(shiftWordStart(cue, words, 1, -300)).toBeNull();
  });
  it("exports and imports exact word endings and silent gaps", () => {
    const words = recordedWords(cue, [1153, 1789, 3234], 4021)!;
    words[0].endMs = 1500;
    const parsed = parseLRC(
      serializeLyrics([
        { ...cue, words },
        { startMs: 5000, endMs: 8000, text: "Далі граємо" },
      ]),
    );
    expect(parsed[0].words).toEqual(words);
    expect(parsed[0].text).toBe(cue.text);
    expect(parsed[1].words).toBeUndefined();
    expect(
      validWordTiming(cue, [{ ...words[0], text: "Сторонні слова" }]),
    ).toBe(false);
  });
});
