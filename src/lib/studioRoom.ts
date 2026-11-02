import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeCue,
  type Session,
  type Track,
  type Phase,
  type Team,
} from "./music";
import type { ShowState } from "./show";
import { RoomClock } from "./roomClock";
import type { PreparedSummary } from "./preparedSongs";

export type RoomAccess = {
  code: string;
  stationToken: string;
  hostToken: string;
  expiresAt: number;
};
export type RoomAudio = {
  position: number;
  duration: number;
  playing: boolean;
  ready: boolean;
  local: boolean;
  volume: number;
};
export type RoomTimer = { leftMs: number; deadline: number; paused: boolean };
export type RoomState = {
  library?: PreparedSummary[];
  session: Session;
  track: Track;
  audio: RoomAudio;
  phase: Phase;
  awarded: Team | null;
  timer: RoomTimer;
  version: number;
  effects: boolean;
  needsTrack: boolean;
  notice: string;
};
export type Presence = { host: boolean; station: boolean; audience: number };
export type Instruction = {
  prepared?: boolean;
  type: string;
  id: string;
  position?: number;
  trackId?: number;
};
export type RoomAction = {
  type: string;
  team?: Team | null;
  index?: number;
  position?: number;
  trackId?: number;
  config?: {
    names: Session["names"];
    rounds: number;
    answerSeconds: number;
    effects: boolean;
  };
};
export type Connection = {
  code: string;
  token?: string;
  role: "station" | "host" | "audience";
};
export function savedRoom(): RoomAccess | null {
  try {
    const r = JSON.parse(sessionStorage.getItem("khz:network-room") ?? "null");
    return r &&
      /^[A-Z2-9]{6}$/.test(r.code) &&
      typeof r.stationToken === "string" &&
      typeof r.hostToken === "string" &&
      r.expiresAt > Date.now()
      ? r
      : null;
  } catch {
    return null;
  }
}
export function rememberRoom(r: RoomAccess | null) {
  try {
    r
      ? sessionStorage.setItem("khz:network-room", JSON.stringify(r))
      : sessionStorage.removeItem("khz:network-room");
  } catch {}
}
export function roomURL(
  code: string,
  role: "host" | "audience",
  token?: string,
) {
  const u = new URL("/", location.origin);
  u.searchParams.set("screen", role === "host" ? "remote" : "room");
  u.searchParams.set("room", code);
  if (token) u.hash = new URLSearchParams({ token }).toString();
  return u.href;
}
export function linkConnection(role: "host" | "audience"): Connection {
  const code = new URLSearchParams(location.search).get("room") ?? "";
  let token =
    new URLSearchParams(location.hash.slice(1)).get("token") ?? undefined;
  try {
    const key = "khz:host:" + code;
    if (token && role === "host") {
      sessionStorage.setItem(key, token);
      history.replaceState(null, "", location.pathname + location.search);
    } else if (role === "host")
      token = sessionStorage.getItem(key) ?? undefined;
  } catch {}
  return { role, code, token };
}
export function roomRemaining(state: RoomState, serverNow: number) {
  return Math.max(
    0,
    Math.ceil(
      (state.timer.paused || !state.timer.deadline
        ? state.timer.leftMs
        : state.timer.deadline - serverNow) / 1000,
    ),
  );
}
export function roomScene(
  state: RoomState,
  serverNow: number,
  connected = true,
): ShowState {
  const { session: s, track: t, audio: a } = state,
    nowMS = a.position * 1000 + s.offset;
  const current = s.aligned ? activeCue(t.cues, nowMS) : -1,
    visible = state.phase === "playing" && current >= 0 && current < s.target;
  const result = s.history.find((r) => r.round === s.round);
  return {
    eventName: s.programme?.title,
    scores: s.scores,
    names: s.names,
    team: s.team,
    round: s.round,
    rounds: s.rounds,
    phase: state.phase,
    playing: connected && a.playing,
    nowMS,
    lyric: visible ? t.cues[current].text : "",
    words: visible ? t.cues[current].words : undefined,
    ...(state.phase === "result" || state.phase === "final"
      ? { answer: result?.line, track: result?.track }
      : {}),
    awarded: state.awarded,
    remaining: roomRemaining(state, serverNow),
    timerPaused: !connected || state.timer.paused,
    effects: state.effects,
  };
}
export function useStudioConnection(
  connection: Connection,
  onInstruction?: (instruction: Instruction) => void,
) {
  const [state, setState] = useState<RoomState | null>(null),
    [scene, setScene] = useState<ShowState | null>(null);
  const [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [terminal, setTerminal] = useState(false),
    [pending, setPending] = useState(false);
  const [presence, setPresence] = useState<Presence>({
    host: false,
    station: false,
    audience: 0,
  });
  const [now, setNow] = useState(0);
  const clock = useRef(new RoomClock());
  const socket = useRef<WebSocket | null>(null),
    latest = useRef(state),
    handler = useRef(onInstruction),
    pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = state;
  handler.current = onInstruction;
  const { code, token, role } = connection;
  useEffect(() => {
    let disposed = false,
      stopped = false,
      authenticated = false,
      lastMessage = performance.now(),
      retry: ReturnType<typeof setTimeout> | undefined,
      attempt = 0;
    const open = () => {
      const url = new URL("/api/studio/ws", location.origin);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => {
        lastMessage = performance.now();
        ws.send(JSON.stringify({ type: "auth", role, code, token }));
      };
      ws.onmessage = (e) => {
        if (disposed || socket.current !== ws) return;
        lastMessage = performance.now();
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (
          m.type === "fatal" ||
          m.type === "replaced" ||
          m.type === "closed"
        ) {
          stopped = true;
          clock.current.freeze(performance.now());
          setNow(clock.current.read(performance.now()));
          setTerminal(true);
          setConnected(false);
          setError(m.message || "З’єднання завершено.");
          ws.close();
          return;
        }
        if (m.type === "error") {
          setError(m.message);
          setPending(false);
          return;
        }
        if (m.type === "instruction") {
          handler.current?.(m.instruction);
          return;
        }
        if (m.type === "state" || m.type === "scene" || m.type === "clock") {
          if (!authenticated) {
            setError("");
            authenticated = true;
          }
          setConnected(true);
          setTerminal(false);
          attempt = 0;
          if (typeof m.serverTime === "number") {
            clock.current.sync(m.serverTime, performance.now());
            setNow(clock.current.read(performance.now()));
          }
          if (m.presence) setPresence(m.presence);
          if (m.type === "state") {
            setState(m.state);
            setPending(false);
          }
          if (m.type === "scene") setScene(m.state);
          if (m.type === "clock")
            setState((previous) =>
              previous
                ? {
                    ...previous,
                    audio: m.audio,
                    timer: m.timer,
                    phase: m.phase,
                    version: m.version,
                  }
                : previous,
            );
        }
      };
      ws.onclose = () => {
        if (disposed || socket.current !== ws) return;
        clock.current.freeze(performance.now());
        setNow(clock.current.read(performance.now()));
        authenticated = false;
        setConnected(false);
        setPending(false);
        if (!stopped) {
          setError("Зв’язок перервано. Відновлюємо підключення…");
          retry = setTimeout(open, Math.min(8000, 500 * 2 ** attempt++));
        }
      };
      ws.onerror = () => ws.close();
    };
    retry = setTimeout(open, 0);
    const tick = setInterval(() => {
      setNow(clock.current.read(performance.now()));
      if (
        socket.current?.readyState === WebSocket.OPEN &&
        performance.now() - lastMessage > 5000
      ) {
        setConnected(false);
        clock.current.freeze(performance.now());
        setNow(clock.current.read(performance.now()));
        socket.current.close();
      }
    }, 200);
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(tick);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      socket.current?.close();
      socket.current = null;
    };
  }, [code, token, role]);
  const send = useCallback((message: unknown) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(message));
    return true;
  }, []);
  const action = useCallback(
    (a: RoomAction) => {
      const s = latest.current;
      if (!s || socket.current?.readyState !== WebSocket.OPEN) {
        setError("Дочекайся з’єднання з грою.");
        return false;
      }
      setError("");
      setPending(true);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => setPending(false), 2500);
      return send({
        type: "action",
        action: { ...a, id: crypto.randomUUID(), version: s.version },
      });
    },
    [send],
  );
  return {
    state,
    scene:
      scene && !connected
        ? { ...scene, playing: false, timerPaused: true }
        : scene,
    connected,
    error,
    terminal,
    presence,
    pending,
    send,
    action,
    serverNow: now,
  };
}
