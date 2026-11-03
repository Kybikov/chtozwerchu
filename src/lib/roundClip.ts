import type { Cue } from "./music";

export const clipLengths = [5, 7, 10, 15] as const;
export function validClipLength(value: unknown): value is number {
  return (
    typeof value === "number" &&
    (clipLengths as readonly number[]).includes(value)
  );
}
export function clipLength(value: unknown) {
  return validClipLength(value) ? value : 7;
}
export function roundClip(
  cue: Cue | undefined,
  offset: number,
  duration: number,
  requested: unknown,
) {
  if (!cue || !Number.isFinite(offset) || !Number.isFinite(duration))
    return null;
  const end = (cue.startMs - offset) / 1000;
  if (!Number.isFinite(end) || end <= 0.3 || end > duration - 0.2) return null;
  const start = Math.max(0, end - clipLength(requested));
  return { start, end, seconds: end - start };
}
