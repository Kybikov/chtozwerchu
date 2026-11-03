import { useCallback, useEffect, useRef, useState } from "react";
import type { usePlayer } from "./usePlayer";

type Range = { start: number; end: number };

// The real audio clock owns both line auditions and round-preview cutoffs.
export function useAudioExcerpt(
  player: ReturnType<typeof usePlayer>,
  resetKey: string,
) {
  const [active, setActive] = useState<number | null>(null);
  const range = useRef<Range | null>(null);
  const generation = useRef(0);
  const audioRef = player.ref;
  const stop = useCallback(() => {
    generation.current++;
    range.current = null;
    audioRef.current?.pause();
    setActive(null);
  }, [audioRef]);

  useEffect(() => {
    stop();
    return () => {
      generation.current++;
      range.current = null;
      audioRef.current?.pause();
    };
  }, [resetKey, audioRef, stop]);

  useEffect(() => {
    if (active === null) return;
    const audio = audioRef.current;
    if (!audio) return;
    let frame = 0;
    const tick = () => {
      const selected = range.current;
      if (!selected) return;
      if (
        audio.currentTime >= selected.end ||
        audio.currentTime < selected.start - 0.05
      ) {
        stop();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const paused = () => {
      if (audio.paused) {
        range.current = null;
        setActive(null);
      }
    };
    audio.addEventListener("pause", paused);
    audio.addEventListener("error", stop);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("error", stop);
    };
  }, [active, audioRef, stop]);

  const play = async (key: number, next: Range) => {
    if (active === key) {
      stop();
      return;
    }
    if (
      !player.ready ||
      !Number.isFinite(next.start) ||
      !Number.isFinite(next.end) ||
      next.start < 0 ||
      next.end <= next.start ||
      next.end > player.duration
    )
      return;
    stop();
    const request = generation.current;
    player.seek(next.start);
    range.current = next;
    setActive(key);
    if (!(await player.play()) && request === generation.current) stop();
  };
  return { active, play, stop };
}
