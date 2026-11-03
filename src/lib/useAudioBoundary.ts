import { useEffect, useRef, type RefObject } from "react";
import { watchAudioBoundary } from "./audioBoundary";

export function useAudioBoundary(
  audio: RefObject<HTMLAudioElement | null>,
  enabled: boolean,
  endSeconds: number | undefined,
  onReached: () => void,
) {
  const latest = useRef({ enabled, endSeconds, onReached });
  latest.current = { enabled, endSeconds, onReached };
  useEffect(() => {
    if (!enabled || endSeconds === undefined || !audio.current) return;
    return watchAudioBoundary(audio.current, endSeconds, () => {
      const current = latest.current;
      if (current.enabled && current.endSeconds === endSeconds)
        current.onReached();
    });
  }, [audio, enabled, endSeconds]);
}
