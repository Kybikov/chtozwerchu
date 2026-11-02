import { describe, expect, it } from "vitest";
import { freshSession, type RoundRecord } from "./music";
import {
  matchWinner,
  nextPlayableTarget,
  scoreRound,
  undoRound,
} from "./match";

const result: RoundRecord = {
  round: 1,
  team: "girls",
  awarded: "boys",
  track: "Test",
  line: "Answer",
  trackId: 1,
  target: 2,
};
describe("music match", () => {
  it("scores exactly once even if the host repeats the action", () => {
    const scored = scoreRound(freshSession(), result);
    expect(scored.scores).toEqual({ girls: 0, boys: 3 });
    expect(scoreRound(scored, result)).toBe(scored);
    expect(scoreRound(scored, { ...result, awarded: "girls" })).toBe(scored);
  });
  it("ignores a stale round result", () => {
    const s = { ...freshSession(), round: 2 };
    expect(scoreRound(s, result)).toBe(s);
  });
  it("records an unanswered round, then allows correcting its award", () => {
    const s = scoreRound(freshSession(), { ...result, awarded: null });
    expect(s.history).toHaveLength(1);
    const corrected = scoreRound(undoRound(s), result);
    expect(corrected.scores.boys).toBe(3);
    expect(corrected.history).toHaveLength(1);
  });
  it("preserves manual score adjustments when undoing the current award", () => {
    const s = scoreRound(freshSession(), result);
    expect(undoRound({ ...s, scores: { girls: 2, boys: 4 } }).scores).toEqual({
      girls: 2,
      boys: 1,
    });
    expect(undoRound({ ...s, round: 2 })).toEqual({ ...s, round: 2 });
  });
  it("chooses only new target lines inside the actual audio fragment", () => {
    const cues = [0, 3000, 6000, 9000, 20000].map((startMs) => ({
      startMs,
      endMs: startMs + 2000,
      text: "line",
    }));
    expect(nextPlayableTarget(cues, 0, 12, 2, [2])).toBe(3);
    expect(nextPlayableTarget(cues, 0, 12, 3, [1, 2, 3])).toBeNull();
    expect(nextPlayableTarget(cues, 15000, 8, 0, [])).toBe(4);
  });
  it("determines a winner and handles a tie", () => {
    expect(matchWinner({ girls: 6, boys: 3 })).toBe("girls");
    expect(matchWinner({ girls: 3, boys: 9 })).toBe("boys");
    expect(matchWinner({ girls: 6, boys: 6 })).toBeNull();
  });
});
