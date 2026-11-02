import type { Cue, WordCue } from "./music";

const clean = (text: string) => text.trim().replace(/\s+/gu, " ");
const plurals = new Intl.PluralRules("uk");
export const timingCount = (count: number) => {
  const form = plurals.select(count);
  return `${count} ${form === "one" ? "мітка" : form === "few" ? "мітки" : "міток"}`;
};
export const lyricTokens = (text: string) => text.trim().match(/\S+/gu) ?? [];
export const preciseTime = (milliseconds: number) => {
  const ms = Math.max(0, Math.round(milliseconds));
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

export function validWordTiming(
  cue: Cue,
  words: WordCue[] | undefined,
): words is WordCue[] {
  return (
    !!words?.length &&
    words.length <= 300 &&
    clean(words.map((w) => w.text).join("")) === clean(cue.text) &&
    words.every(
      (w, i) =>
        Number.isInteger(w.startMs) &&
        Number.isInteger(w.endMs) &&
        w.startMs >= cue.startMs &&
        w.endMs <= cue.endMs &&
        w.endMs > w.startMs &&
        (!i || w.startMs >= words[i - 1].endMs),
    )
  );
}

// Every boundary is sampled from the audio element, never divided by word count.
export function recordedWords(
  cue: Cue,
  starts: number[],
  endMs: number,
): WordCue[] | null {
  const tokens = lyricTokens(cue.text);
  if (starts.length !== tokens.length || !tokens.length) return null;
  const words = tokens.map((text, i) => ({
    text: text + (i < tokens.length - 1 ? " " : ""),
    startMs: starts[i],
    endMs: starts[i + 1] ?? endMs,
  }));
  return validWordTiming(cue, words) ? words : null;
}

export function shiftWordStart(
  cue: Cue,
  words: WordCue[],
  index: number,
  delta: number,
): WordCue[] | null {
  if (!words[index]) return null;
  const next = words.map((w) => ({ ...w }));
  const oldStart = next[index].startMs;
  next[index].startMs += delta;
  // A shared boundary moves together; intentional silence remains silence.
  if (index > 0 && next[index - 1].endMs === oldStart)
    next[index - 1].endMs += delta;
  return validWordTiming(cue, next) ? next : null;
}

export function serializeLyrics(cues: Cue[]): string {
  return (
    cues
      .map((cue) => {
        const content = validWordTiming(cue, cue.words)
          ? cue.words
              .map(
                (w) =>
                  `<${preciseTime(w.startMs)}>${w.text}<${preciseTime(w.endMs)}>`,
              )
              .join("")
          : cue.text;
        return `[${preciseTime(cue.startMs)}]${content.replace(/[\r\n]+/g, " ")}`;
      })
      .join("\n") + "\n"
  );
}
