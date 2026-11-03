import type { Track } from "./music";

// Decode enough of the new source before replacing the working player.
// This element never plays and releases its request on every exit path.
export function probeAudio(
  src: string,
  signal: AbortSignal,
  create: () => HTMLAudioElement = () => new Audio(),
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const audio = create();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", abort);
      audio.removeAttribute("src");
      audio.load();
      if (error) reject(error);
      else resolve();
    };
    const ready = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) finish();
      else failed();
    };
    const failed = () =>
      finish(
        new Error(
          "Прев’ю не вдалося відкрити. Спробуй ще раз або обери власний файл.",
        ),
      );
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(failed, 12000);
    audio.addEventListener("canplay", ready);
    audio.addEventListener("error", failed);
    signal.addEventListener("abort", abort, { once: true });
    audio.preload = "auto";
    audio.src = src;
    audio.load();
  });
}

export async function preparePreview(
  track: Track,
  lookup: (id: number) => Promise<Track>,
  signal: AbortSignal,
  probe = probeAudio,
): Promise<Track> {
  const current = await lookup(track.id);
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (current.id !== track.id || !/^https:\/\//.test(current.preview))
    throw new Error(
      "Прев’ю цього запису недоступне. Обери власний файл або інший трек.",
    );
  await probe(current.preview, signal);
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  // The imported lyrics and word boundaries belong to the host's preparation.
  return { ...track, preview: current.preview };
}
