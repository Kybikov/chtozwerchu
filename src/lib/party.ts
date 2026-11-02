import { useCallback, useEffect, useRef, useState } from "react";
import type { Team } from "./music";

export const contests = [
  {
    id: "five_words",
    title: "5 слів",
    label: "ЗГАДАЙ ПІСНЮ",
    description:
      "Відкривай слова й упізнай пісню. Менше підказок — більше балів.",
    short: "Слова з пісень",
  },
  {
    id: "melody",
    title: "Вгадай мелодію",
    label: "ЛОВИ МЕЛОДІЮ",
    description:
      "Послухайте фрагмент і назвіть пісню. Підказки зменшують кількість балів.",
    short: "Музичний слух",
  },
  {
    id: "alias",
    title: "Аліас",
    label: "ПОЯСНИ ІНАКШЕ",
    description:
      "Пояснюй слова, уникаючи заборонених. За 75 секунд вгадайте якомога більше.",
    short: "Слова без слів",
  },
  {
    id: "crocodile",
    title: "Емодзі-ребус",
    label: "ПРОЧИТАЙ ЕМОДЗІ",
    description:
      "За емодзі ховається відповідь. Вгадайте до завершення 45 секунд.",
    short: "Логіка в картинках",
  },
  {
    id: "truth_lie",
    title: "Правда чи брехня",
    label: "ВІРИТЕ ЧИ НІ?",
    description:
      "Обговоріть факт командою та дайте одну спільну відповідь за 25 секунд.",
    short: "Несподівані факти",
  },
] as const;
export type Contest = (typeof contests)[number]["id"];
export type PartyResult = {
  won: boolean;
  points: number;
  team: Team;
  answer: string;
  detail?: string;
};
export type PartyView = {
  code: string;
  stage: "lobby" | "playing" | "result" | "final";
  config: { rounds: number; roundTypes: Contest[]; preset: string };
  teams: Record<Team, { name: string; score: number }>;
  players: {
    id: string;
    name: string;
    team: Team;
    host: boolean;
    connected: boolean;
  }[];
  activeTeam: Team;
  roundIndex: number;
  rounds: number;
  roundType?: Contest;
  paused: boolean;
  deadlineMs?: number;
  remainingMs?: number;
  round?: {
    slots?: { revealed: boolean; word?: string }[];
    potential?: number;
    previewUrl?: string;
    previewStatus?: string;
    awaitingAudio?: boolean;
    hints?: string[];
    hint?: string;
    hostAnswer?: string;
    emoji?: string;
    statement?: string;
    scored?: number;
    skipped?: number;
    total?: number;
    index?: number;
    explainerId?: string;
    explainerName?: string;
    current?: { word: string; taboo: string[] };
    cards?: string[];
    fact?: string;
    truth?: boolean;
  };
  result?: PartyResult;
  winner?: Team;
  history?: { round: number; type: Contest; result: PartyResult }[];
  you?: {
    playerId: string;
    name: string;
    team: Team;
    host: boolean;
    registered: boolean;
  };
};
type Access = { code: string; token: string; name: string; team: Team };
const key = "khz:party:access";
function stored(): Access | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(key) || "null");
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
type Intent = {
  type: "create_room" | "join" | "watch";
  payload: Record<string, unknown>;
};
export function useParty() {
  const params = new URLSearchParams(location.search);
  const initialCode = (params.get("code") || "").toUpperCase();
  const watching = params.get("watch") === "1";
  const access = useRef(stored());
  const [intent, setIntent] = useState<Intent | null>(() =>
    watching && /^[A-Z2-9]{5}$/.test(initialCode)
      ? { type: "watch", payload: { code: initialCode } }
      : access.current && (!initialCode || initialCode === access.current.code)
        ? { type: "join", payload: access.current }
        : null,
  );
  const [state, setState] = useState<PartyView | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "reconnecting"
  >("idle");
  const [error, setError] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const locked = useRef(0);
  const reconnect = useRef<Intent | null>(intent);
  useEffect(() => {
    if (!intent) {
      setState(null);
      setStatus("idle");
      return;
    }
    let live = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    let last = Date.now(),
      attempts = 0;
    reconnect.current = intent;
    setError("");
    const connect = () => {
      if (!live) return;
      setStatus(attempts ? "reconnecting" : "connecting");
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        last = Date.now();
        if (reconnect.current) ws.send(JSON.stringify(reconnect.current));
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
        if (data.type === "you_are") {
          const pending = reconnect.current?.payload;
          const a = {
            code: data.code,
            token: data.token,
            name: String(
              pending?.name || pending?.hostName || access.current?.name || "",
            ),
            team: (pending?.team ||
              pending?.hostTeam ||
              access.current?.team ||
              "girls") as Team,
          };
          access.current = a;
          sessionStorage.setItem(key, JSON.stringify(a));
          reconnect.current = { type: "join", payload: a };
          const next = new URL(location.href);
          next.searchParams.set("code", data.code);
          history.replaceState(null, "", next);
        } else if (data.type === "state") {
          setState(data);
          setStatus("connected");
          setError("");
          attempts = 0;
        } else if (data.type === "error") {
          setError(data.message);
          if (!stateRef.current) setStatus("idle");
        }
      };
      ws.onclose = () => {
        if (!live || socket.current !== ws) return;
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
      ws.onerror = () => {
        /* onclose schedules reconnect */
      };
    };
    connect();
    const heartbeat = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - last > 12000) {
          setStatus("reconnecting");
          ws.close();
        } else ws.send(JSON.stringify({ type: "ping", payload: {} }));
      }
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
  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (socket.current?.readyState !== WebSocket.OPEN) {
        setError("Зачекай, поки відновиться з’єднання.");
        return false;
      }
      if (performance.now() < locked.current) return false;
      locked.current = performance.now() + 400;
      setError("");
      socket.current.send(JSON.stringify({ type, payload }));
      return true;
    },
    [],
  );
  const action = useCallback(
    (name: string, payload: Record<string, unknown> = {}) => {
      const s = stateRef.current;
      return send("action", {
        name,
        payload,
        round: s?.roundIndex,
        ...(s?.roundType === "alias" ? { cardIndex: s.round?.index } : {}),
      });
    },
    [send],
  );
  const leave = () => {
    sessionStorage.removeItem(key);
    access.current = null;
    setIntent(null);
    const next = new URL(location.href);
    next.searchParams.delete("code");
    next.searchParams.delete("watch");
    history.replaceState(null, "", next);
    setError("");
  };
  return {
    state,
    status,
    error,
    setError,
    send,
    action,
    leave,
    watching,
    initialCode,
    enter: (type: Intent["type"], payload: Record<string, unknown>) => {
      setState(null);
      setIntent({ type, payload });
    },
  };
}
