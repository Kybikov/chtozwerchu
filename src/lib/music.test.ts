import { describe, expect, it } from "vitest";
import { activeCue, formatTime, parseLRC } from "./music";

describe("audio timeline", () => {
  const cues = [
    { startMs: 1000, endMs: 2500, text: "first" },
    { startMs: 3000, endMs: 5000, text: "second" },
  ];
  it("honours exact starts, exclusive ends, gaps, and backward seeking", () => {
    expect(
      [0, 1000, 2499, 2500, 2999, 3000, 5000, 1500].map((t) =>
        activeCue(cues, t),
      ),
    ).toEqual([-1, 0, 0, -1, -1, 1, -1, 0]);
  });
  it("handles an empty timeline", () => expect(activeCue([], 5000)).toBe(-1));
  it("normalizes fractional LRC times, repeated lines and offsets", () => {
    const parsed = parseLRC(
      "[offset:-200]\n[00:02.50][00:07.125]Тестовий рядок\n[00:05.1]Ще рядок\n[00:05.10]Дублікат\n[00:99]Некоректний час",
    );
    expect(parsed).toEqual([
      { startMs: 2300, endMs: 4900, text: "Тестовий рядок" },
      { startMs: 4900, endMs: 6925, text: "Ще рядок" },
      { startMs: 6925, endMs: 12925, text: "Тестовий рядок" },
    ]);
  });
  it("rejects untimed text rather than inventing synchronization", () =>
    expect(parseLRC("[ar:artist]\nЗвичайний текст")).toEqual([]));
  it("keeps exact enhanced LRC word timestamps and clean display text", () => {
    const cues = parseLRC(
      "[offset:-100]\n[00:01.00]<00:01.00>Лови <00:01.50>цей <00:02.20>ритм\n[00:04.00]Наступний",
    );
    expect(cues[0].text).toBe("Лови цей ритм");
    expect(cues[0].words).toEqual([
      { startMs: 900, endMs: 1400, text: "Лови " },
      { startMs: 1400, endMs: 2100, text: "цей " },
      { startMs: 2100, endMs: 3900, text: "ритм" },
    ]);
    expect(cues[1].words).toBeUndefined();
  });
  it("falls back to line sync for malformed or repeated word timelines", () => {
    expect(parseLRC("[00:01]<00:01>раз <00:00.5>два")[0].words).toBeUndefined();
    expect(
      parseLRC("[00:01][00:05]<00:01>раз <00:02>два").every((c) => !c.words),
    ).toBe(true);
  });
  it("formats non-finite media duration safely", () => {
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(95.9)).toBe("1:35");
  });
});
