import type { Cue } from "./music";

// A line preview must fit the actual audio. Never seek a preview into an
// unrelated part of a shorter recording or silently trim a lyric line.
export function cueAudioRange(cue: Cue, offset: number, duration: number) {
  const start = (cue.startMs - offset) / 1000;
  const end = (cue.endMs - offset) / 1000;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(duration) ||
    start < 0 ||
    end <= start ||
    end > duration
  )
    return null;
  return { start, end };
}
