import { useEffect, useRef, useState } from "react";

export function usePlayer(src: string, onError: (message: string) => void) {
  const ref = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [volume, setVolume] = useState(65);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const errors = useRef(onError);
  errors.current = onError;
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.pause();
    setPosition(0);
    setDuration(0);
    setPlaying(false);
    setReady(false);
    setFailed(false);
    setLoading(!!src);
    if (src) {
      audio.src = src;
      audio.load();
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
    const metadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setReady(true);
      setLoading(false);
    };
    const play = () => setPlaying(true),
      pause = () => setPlaying(false);
    const waiting = () => setLoading(true),
      canplay = () => setLoading(false);
    const time = () => setPosition(audio.currentTime);
    const error = () => {
      setFailed(true);
      setLoading(false);
      setReady(false);
      setPlaying(false);
      errors.current(
        "Аудіо не завантажилося. Спробуй інший трек або власний файл.",
      );
    };
    audio.addEventListener("loadedmetadata", metadata);
    audio.addEventListener("play", play);
    audio.addEventListener("pause", pause);
    audio.addEventListener("ended", pause);
    audio.addEventListener("timeupdate", time);
    audio.addEventListener("seeked", time);
    audio.addEventListener("waiting", waiting);
    audio.addEventListener("canplay", canplay);
    audio.addEventListener("error", error);
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      if (!audio.paused && now - last > 60) {
        setPosition(audio.currentTime);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      audio.pause();
      cancelAnimationFrame(frame);
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("play", play);
      audio.removeEventListener("pause", pause);
      audio.removeEventListener("ended", pause);
      audio.removeEventListener("timeupdate", time);
      audio.removeEventListener("seeked", time);
      audio.removeEventListener("waiting", waiting);
      audio.removeEventListener("canplay", canplay);
      audio.removeEventListener("error", error);
    };
  }, [src]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume / 100;
  }, [volume]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && ref.current && !ref.current.paused) {
        ref.current.pause();
        errors.current("Музика на паузі: повернись на сцену й продовжуй гру.");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  const pause = () => ref.current?.pause();
  const play = async () => {
    if (!ref.current || !src) return false;
    try {
      await ref.current.play();
      return true;
    } catch {
      errors.current("Натисни «Відтворити», щоб увімкнути звук.");
      return false;
    }
  };
  const seek = (seconds: number) => {
    const audio = ref.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
    setPosition(audio.currentTime);
  };
  return {
    ref,
    position,
    duration,
    playing,
    loading,
    volume,
    setVolume,
    ready,
    failed,
    play,
    pause,
    seek,
    toggle: () => (playing ? pause() : void play()),
  };
}
