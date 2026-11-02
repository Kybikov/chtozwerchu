import { useEffect, useRef, useState } from "react";

// Only the answer clock uses elapsed wall time. Lyrics always use the audio clock.
export function useAnswerClock(active: boolean, seconds: number) {
  const [remaining, setRemaining] = useState(seconds);
  const [paused, setPaused] = useState(false);
  const left = useRef(seconds * 1000);
  const deadline = useRef(0);
  useEffect(() => {
    left.current = seconds * 1000;
    deadline.current = performance.now() + left.current;
    setRemaining(seconds);
    setPaused(false);
  }, [active, seconds]);
  useEffect(() => {
    if (!active || paused) return;
    const update = () => {
      left.current = Math.max(0, deadline.current - performance.now());
      setRemaining(Math.ceil(left.current / 1000));
    };
    update();
    const interval = setInterval(update, 80);
    return () => clearInterval(interval);
  }, [active, paused, seconds]);
  useEffect(() => {
    const hide = () => {
      if (active && !paused && document.hidden) {
        left.current = Math.max(0, deadline.current - performance.now());
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [active, paused]);
  const toggle = () => {
    if (paused) deadline.current = performance.now() + left.current;
    else left.current = Math.max(0, deadline.current - performance.now());
    setPaused(!paused);
  };
  return { remaining, paused, toggle };
}
