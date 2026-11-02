import { useEffect, useRef } from "react";
import type { Phase, Session, Team, WordCue } from "./music";

// Audience data deliberately excludes the target answer until the reveal.
export type ShowState = Pick<
  Session,
  "scores" | "names" | "team" | "round" | "rounds"
> & {
  eventName?: string;
  phase: Phase;
  playing: boolean;
  lyric: string;
  words?: WordCue[];
  nowMS: number;
  answer?: string;
  track?: string;
  awarded: Team | null;
  remaining: number;
  timerPaused: boolean;
  effects: boolean;
};

export function useShowBroadcast(state: ShowState, enabled = true) {
  const room = useRef("");
  if (!room.current) {
    const saved = sessionStorage.getItem("khz:show-room");
    room.current =
      saved && /^[\da-f-]{36}$/i.test(saved) ? saved : crypto.randomUUID();
    sessionStorage.setItem("khz:show-room", room.current);
  }
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (!enabled || !("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(`khz:show:${room.current}`);
    channel.onmessage = (e) => {
      if (e.data?.type === "hello")
        channel.postMessage({ type: "scene", state: latest.current });
    };
    const interval = setInterval(
      () => channel.postMessage({ type: "scene", state: latest.current }),
      100,
    );
    return () => {
      clearInterval(interval);
      channel.close();
    };
  }, [enabled]);
  return `/?screen=show&room=${room.current}`;
}
