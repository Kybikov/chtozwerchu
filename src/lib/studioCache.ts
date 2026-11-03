import type { Cue, Track } from "./music";
import { sameCueTimeline } from "./lyricTimeline";
import { validWordTiming } from "./wordTiming";

export type LocalAudio = { file: Blob; trackId: number };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

function validCues(value: unknown): value is Cue[] {
  return (
    Array.isArray(value) &&
    value.length <= 1000 &&
    Array.from(value).every((cue, i) => {
      if (
        !record(cue) ||
        !Number.isSafeInteger(cue.startMs) ||
        !Number.isSafeInteger(cue.endMs) ||
        (cue.startMs as number) < 0 ||
        (cue.endMs as number) <= (cue.startMs as number) ||
        typeof cue.text !== "string" ||
        !cue.text.trim() ||
        cue.text.length > 2000 ||
        (i > 0 && (cue.startMs as number) <= value[i - 1].startMs)
      )
        return false;
      return (
        cue.words === undefined ||
        (Array.isArray(cue.words) &&
          Array.from(cue.words).every(
            (word) =>
              record(word) &&
              typeof word.text === "string" &&
              Number.isSafeInteger(word.startMs) &&
              Number.isSafeInteger(word.endMs),
          ) &&
          validWordTiming(cue as Cue, cue.words))
      );
    })
  );
}

function cachedTrack(value: unknown, id: number): Track | undefined {
  if (
    !record(value) ||
    value.id !== id ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 240 ||
    typeof value.artist !== "string" ||
    value.artist.length > 240 ||
    typeof value.cover !== "string" ||
    value.cover.length > 2048 ||
    (value.cover !== "" && !value.cover.startsWith("https://")) ||
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    value.duration > 86400 ||
    !validCues(value.cues)
  )
    return undefined;
  return {
    id,
    title: value.title,
    artist: value.artist,
    cover: value.cover,
    duration: value.duration,
    cues: value.cues,
    album: typeof value.album === "string" ? value.album : "",
    link:
      typeof value.link === "string" && value.link.startsWith("https://")
        ? value.link
        : "",
    preview:
      typeof value.preview === "string" && value.preview.startsWith("https://")
        ? value.preview
        : "",
    lyricsStatus:
      typeof value.lyricsStatus === "string" ? value.lyricsStatus : "cached",
    lyricsSync:
      value.lyricsSync === "word" ||
      value.lyricsSync === "line" ||
      value.lyricsSync === "mixed"
        ? value.lyricsSync
        : undefined,
  };
}

// All three entries are read in one IndexedDB transaction. A provider preview
// alone is never an offline source: its signed URL may already have expired.
export async function resolveStudioTrack(
  id: number,
  preserve: boolean,
  [rawTrack, rawAudio, rawLyrics]: readonly unknown[],
  lookup: (id: number) => Promise<Track>,
) {
  const previous = cachedTrack(rawTrack, id);
  const audio: LocalAudio | undefined =
    record(rawAudio) &&
    rawAudio.trackId === id &&
    rawAudio.file instanceof Blob &&
    rawAudio.file.size > 0 &&
    rawAudio.file.size <= 150 * 1024 * 1024
      ? { trackId: id, file: rawAudio.file }
      : undefined;
  let track: Track;
  let fromDevice = false;
  if (preserve && previous && audio) {
    track = previous;
    fromDevice = true;
  } else {
    try {
      track = await lookup(id);
    } catch (error) {
      if (!previous || !audio) throw error;
      track = previous;
      fromDevice = true;
    }
  }
  if (validCues(rawLyrics) && rawLyrics.length)
    track = { ...track, cues: rawLyrics, lyricsStatus: "imported" };
  return {
    track,
    audio,
    fromDevice,
    retimed: preserve && !sameCueTimeline(previous?.cues, track.cues),
  };
}
