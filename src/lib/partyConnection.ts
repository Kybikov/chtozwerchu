import { useCallback, useEffect, useRef, useState } from "react";
import type { PartyView } from "./party";
import type { Team } from "./music";

type Access = {
  code: string;
  token: string;
  name: string;
  team: Team;
  tvToken?: string;
};
type Intent = {
  type: "create_room" | "join" | "watch";
  payload: Record<string, unknown>;
};
const playerKey = "khz:party:access";
const tvKey = (code: string) => `khz:party:tv:${code}`;
function saved(): Access | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(playerKey) || "null");
    return /^[A-Z2-9]{5}$/.test(a?.code) &&
      typeof a.token === "string" &&
      a.token.length >= 20 &&
      a.token.length <= 80
      ? a
      : null;
  } catch {
    return null;
  }
}
function locationOptions() {
  const p = new URLSearchParams(location.search),
    code = (p.get("code") || "").toUpperCase();
  const watching = p.get("watch") === "1",
    tv = watching && p.get("audio") === "1";
  let tvToken = "";
  if (tv && /^[A-Z2-9]{5}$/.test(code)) {
    const token = new URLSearchParams(location.hash.slice(1)).get("tv");
    if (token && /^[a-f0-9]{64}$/.test(token))
      sessionStorage.setItem(tvKey(code), token);
    if (location.hash) {
      const clean = new URL(location.href);
      clean.hash = "";
      history.replaceState(null, "", clean);
    }
    tvToken = sessionStorage.getItem(tvKey(code)) || "";
  }
  return { code, watching, tv, tvToken };
}
export function useParty() {
  const [options] = useState(locationOptions),
    access = useRef(saved());
  const [intent, setIntent] = useState<Intent | null>(() =>
    options.watching && /^[A-Z2-9]{5}$/.test(options.code)
      ? options.tv && !options.tvToken
        ? null
        : {
            type: "watch",
            payload: {
              code: options.code,
              tv: options.tv,
              tvToken: options.tvToken,
            },
          }
      : access.current &&
          (!options.code || options.code === access.current.code)
        ? { type: "join", payload: access.current }
        : null,
  );
  const [state, setState] = useState<PartyView | null>(null),
    stateRef = useRef(state);
  stateRef.current = state;
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "reconnecting"
  >("idle");
  const [error, setError] = useState(
    options.tv && !options.tvToken
      ? "Відкрий TV через окреме посилання з пульта ведучого."
      : "",
  );
  const [tvToken, setTVToken] = useState(access.current?.tvToken || "");
  const [tvAuthenticated, setTVAuthenticated] = useState(false);
  const [pending, setPending] = useState(false),
    unlockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [now, setNow] = useState(Date.now()),
    offset = useRef(0);
  const socket = useRef<WebSocket | null>(null),
    locked = useRef(0),
    reconnect = useRef<Intent | null>(intent);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 200);
    return () => {
      clearInterval(tick);
      clearTimeout(unlockTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!intent) {
      setState(null);
      setStatus("idle");
      return;
    }
    let live = true,
      stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let last = Date.now(),
      attempts = 0;
    reconnect.current = intent;
    setError("");
    const connect = () => {
      if (!live || stopped) return;
      setStatus(attempts ? "reconnecting" : "connecting");
      setTVAuthenticated(false);
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        last = Date.now();
        if (reconnect.current)
          ws.send(
            JSON.stringify({
              ...reconnect.current,
              payload: { ...reconnect.current.payload, protocol: 3 },
            }),
          );
      };
      ws.onmessage = (event) => {
        if (!live || socket.current !== ws) return;
        last = Date.now();
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (
          typeof data.serverTime === "number" &&
          Number.isFinite(data.serverTime)
        ) {
          const received = Date.now();
          offset.current = received - data.serverTime;
          setNow(received);
        }
        if (data.type === "you_are") {
          const p = reconnect.current?.payload;
          const a: Access = {
            code: data.code,
            token: data.token,
            name: String(p?.name || p?.hostName || access.current?.name || ""),
            team: (p?.team ||
              p?.hostTeam ||
              access.current?.team ||
              "girls") as Team,
            ...(data.tvToken ? { tvToken: data.tvToken } : {}),
          };
          access.current = a;
          sessionStorage.setItem(playerKey, JSON.stringify(a));
          setTVToken(a.tvToken || "");
          reconnect.current = { type: "join", payload: a };
          const url = new URL(location.href);
          url.searchParams.set("code", data.code);
          history.replaceState(null, "", url);
        } else if (data.type === "watching") {
          setTVAuthenticated(data.tv === true);
        } else if (data.type === "state") {
          setState(data);
          setStatus("connected");
          setError("");
          attempts = 0;
        } else if (data.type === "media_clock") {
          setState((previous) =>
            previous ? { ...previous, media: data.media } : previous,
          );
        } else if (data.type === "replaced" || data.type === "fatal") {
          stopped = true;
          setStatus("idle");
          setPending(false);
          setError(data.message || "Це підключення завершено.");
          ws.close();
        } else if (data.type === "error") {
          setError(data.message);
          setPending(false);
          if (!stateRef.current) {
            stopped = true;
            setStatus("idle");
            ws.close();
          }
        }
      };
      ws.onclose = () => {
        if (!live || stopped || socket.current !== ws) return;
        setPending(false);
        if (reconnect.current?.type === "create_room") {
          setError(
            "Зв’язок перервався до підтвердження кімнати. Створи гру ще раз.",
          );
          setStatus("idle");
          return;
        }
        setStatus("reconnecting");
        attempts++;
        timer = setTimeout(connect, Math.min(1000 * attempts, 5000));
      };
      ws.onerror = () => ws.close();
    };
    timer = setTimeout(connect, 0);
    const heartbeat = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - last > 12000) {
        setStatus("reconnecting");
        setPending(false);
        socket.current = null;
        ws.close();
        attempts++;
        timer = setTimeout(connect, 0);
      } else ws.send(JSON.stringify({ type: "ping", payload: {} }));
    }, 3000);
    return () => {
      live = false;
      clearTimeout(timer);
      clearInterval(heartbeat);
      const ws = socket.current;
      socket.current = null;
      ws?.close();
    };
  }, [intent]);
  const transmit = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (socket.current?.readyState !== WebSocket.OPEN) return false;
      socket.current.send(JSON.stringify({ type, payload }));
      return true;
    },
    [],
  );
  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (type === "media_status") return transmit(type, payload);
      if (socket.current?.readyState !== WebSocket.OPEN) {
        setError("Зачекай, поки відновиться з’єднання.");
        return false;
      }
      if (performance.now() < locked.current) return false;
      locked.current = performance.now() + 400;
      setPending(true);
      clearTimeout(unlockTimer.current);
      unlockTimer.current = setTimeout(() => setPending(false), 400);
      setError("");
      return transmit(type, payload);
    },
    [transmit],
  );
  const action = useCallback(
    (name: string, payload: Record<string, unknown> = {}) => {
      const s = stateRef.current;
      const body = {
        name,
        payload,
        round: s?.roundIndex,
        ...(s?.roundType === "alias" ? { cardIndex: s.round?.index } : {}),
      };
      return name === "audio_volume"
        ? transmit("action", body)
        : send("action", body);
    },
    [send, transmit],
  );
  const leave = () => {
    if (options.tv) sessionStorage.removeItem(tvKey(options.code));
    else sessionStorage.removeItem(playerKey);
    access.current = null;
    setTVToken("");
    setIntent(null);
    setError("");
    const u = new URL(location.href);
    u.searchParams.delete("code");
    u.searchParams.delete("watch");
    u.searchParams.delete("audio");
    history.replaceState(null, "", u);
  };
  return {
    state,
    status,
    error,
    setError,
    pending,
    send,
    action,
    leave,
    watching: options.watching,
    isTV: options.tv && tvAuthenticated,
    tvRequested: options.tv,
    tvToken,
    initialCode: options.code,
    serverNow: now - offset.current,
    enter: (type: Intent["type"], payload: Record<string, unknown>) => {
      setState(null);
      setIntent({ type, payload });
    },
  };
}
