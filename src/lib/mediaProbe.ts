export type MediaProbeOptions = {
  create?: () => HTMLAudioElement;
  positions?: (duration: number) => number[];
};

// A separate, silent element verifies decoder readiness and selected seek
// positions. It never calls play() or changes the host's working player.
export function inspectMedia(
  src: string,
  signal: AbortSignal,
  options: MediaProbeOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const audio = (options.create ?? (() => new Audio()))();
    let settled = false,
      positions: number[] | undefined,
      index = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      const duration = audio.duration;
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("seeked", ready);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", abort);
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch {
        /* The request is already detached. */
      }
      if (error) reject(error);
      else resolve(duration);
    };
    const failed = () =>
      finish(
        new Error(
          "Аудіо не вдалося відкрити або перемотати на цьому пристрої.",
        ),
      );
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const seek = () => {
      try {
        audio.currentTime = positions![index];
      } catch {
        failed();
      }
    };
    const metadata = () => {
      if (settled || !options.positions || positions) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0)
        return failed();
      try {
        positions = options.positions(audio.duration);
        if (
          !positions.length ||
          positions.some(
            (p) => !Number.isFinite(p) || p < 0 || p >= audio.duration,
          )
        )
          return failed();
        seek();
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error("Перевір фрагмент пісні."),
        );
      }
    };
    const ready = () => {
      if (settled) return;
      if (!Number.isFinite(audio.duration) || audio.duration <= 0)
        return failed();
      if (options.positions) {
        if (!positions) metadata();
        if (
          settled ||
          !positions ||
          audio.seeking ||
          audio.readyState < 3 ||
          Math.abs(audio.currentTime - positions[index]) > 0.12
        )
          return;
        if (++index < positions.length) {
          seek();
          return;
        }
      }
      finish();
    };
    const timer = setTimeout(failed, 12000);
    audio.addEventListener("loadedmetadata", metadata);
    audio.addEventListener("canplay", ready);
    audio.addEventListener("seeked", ready);
    audio.addEventListener("error", failed);
    signal.addEventListener("abort", abort, { once: true });
    audio.preload = "auto";
    audio.muted = true;
    try {
      audio.src = src;
      audio.load();
    } catch {
      failed();
    }
  });
}
