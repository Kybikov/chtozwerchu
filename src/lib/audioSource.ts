import type { Track } from "./music";
import { inspectMedia } from "./mediaProbe";

// Decode enough of the new source before replacing the working player.
// This element never plays and releases its request on every exit path.
export function probeAudio(
  src: string,
  signal: AbortSignal,
  create: () => HTMLAudioElement = () => new Audio(),
): Promise<void> {
  return inspectMedia(src, signal, { create }).then(() => {});
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
