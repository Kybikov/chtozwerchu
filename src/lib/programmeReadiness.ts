import { api, type Track } from "./music";
import { inspectMedia, type MediaProbeOptions } from "./mediaProbe";
import {
  readPrepared,
  validPrepared,
  type PreparedSong,
} from "./preparedSongs";
import { roundClip } from "./roundClip";

export type SongReadiness = {
  id: number;
  status: "checking" | "ready" | "error";
  source: "local" | "preview" | "missing";
  message: string;
  seconds?: number;
};
type Dependencies = {
  read: (id: number) => Promise<PreparedSong | null>;
  lookup: (id: number, signal: AbortSignal) => Promise<Track>;
  inspect: (
    url: string,
    signal: AbortSignal,
    options: MediaProbeOptions,
  ) => Promise<number>;
  createURL: (file: Blob) => string;
  revokeURL: (url: string) => void;
};
const defaults: Dependencies = {
  read: readPrepared,
  lookup: (id, signal) => api<Track>(`/api/music/track?id=${id}`, signal),
  inspect: inspectMedia,
  createURL: (file) => URL.createObjectURL(file),
  revokeURL: (url) => URL.revokeObjectURL(url),
};
const cancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
};

export async function checkProgrammeAudio(
  ids: number[],
  signal: AbortSignal,
  onProgress: (result: SongReadiness) => void,
  dependencies: Partial<Dependencies> = {},
): Promise<SongReadiness[]> {
  const d = { ...defaults, ...dependencies },
    results: SongReadiness[] = [];
  for (const id of ids) {
    cancelled(signal);
    let source: SongReadiness["source"] = "missing",
      objectURL = "";
    onProgress({
      id,
      status: "checking",
      source,
      message: "Перевіряємо аудіо…",
    });
    try {
      const song = await d.read(id);
      cancelled(signal);
      if (!song || !validPrepared(song))
        throw new Error("Підготовку не знайдено. Віднови її в бібліотеці.");
      source = song.file ? "local" : "preview";
      onProgress({
        id,
        status: "checking",
        source,
        message:
          source === "local"
            ? "Відкриваємо файл і фрагмент…"
            : "Оновлюємо та відкриваємо прев’ю…",
      });
      let url: string;
      if (song.file) url = objectURL = d.createURL(song.file);
      else {
        const current = await d.lookup(id, signal);
        cancelled(signal);
        if (current.id !== id || !/^https:\/\//.test(current.preview))
          throw new Error(
            "Прев’ю недоступне. Додай власне аудіо або обери іншу пісню.",
          );
        url = current.preview;
      }
      let seconds = 0;
      await d.inspect(url, signal, {
        positions: (duration) => {
          const clip = roundClip(
            song.track.cues[song.target],
            song.offset,
            duration,
            song.leadInSeconds,
          );
          if (!clip)
            throw new Error(
              "Рядок виходить за межі аудіо. Перевір прив’язку та збережи підготовку.",
            );
          seconds = clip.seconds;
          return [clip.start, Math.max(clip.start, clip.end - 0.1)];
        },
      });
      cancelled(signal);
      const result: SongReadiness = {
        id,
        status: "ready",
        source,
        seconds,
        message:
          source === "local"
            ? "Файл і фрагмент відкрилися"
            : "Прев’ю відкрилося · потрібна мережа",
      };
      results.push(result);
      onProgress(result);
    } catch (error) {
      cancelled(signal);
      const result: SongReadiness = {
        id,
        status: "error",
        source,
        message:
          error instanceof Error && !(error instanceof DOMException)
            ? error.message
            : "Не вдалося перевірити аудіо. Спробуй ще раз.",
      };
      results.push(result);
      onProgress(result);
    } finally {
      if (objectURL) d.revokeURL(objectURL);
    }
  }
  return results;
}
