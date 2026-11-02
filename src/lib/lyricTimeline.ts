import type { Cue } from "./music";
import { validWordTiming } from "./wordTiming";

export function wordCoverage(cues: Cue[]) {
  let lines = 0,
    words = 0;
  for (const cue of cues) {
    if (validWordTiming(cue, cue.words)) {
      lines++;
      words += cue.words.length;
    }
  }
  return { lines, words, total: cues.length };
}

// Adding word boundaries inside the same line does not invalidate calibration.
// Moving a line, changing its text, or replacing the source does.
export function sameCueTimeline(previous: Cue[] | undefined, current: Cue[]) {
  return (
    Array.isArray(previous) &&
    previous.length === current.length &&
    previous.every(
      (cue, i) =>
        cue &&
        cue.startMs === current[i].startMs &&
        cue.endMs === current[i].endMs &&
        cue.text === current[i].text,
    )
  );
}
