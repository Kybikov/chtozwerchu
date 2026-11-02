export type WordCue = { startMs: number; endMs: number; text: string };
export type Cue = {
  startMs: number;
  endMs: number;
  text: string;
  words?: WordCue[];
};
export type Track = {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  preview: string;
  link: string;
  cues: Cue[];
  lyricsStatus: string;
};
export type Team = "girls" | "boys";
export type Phase = "ready" | "playing" | "answer" | "result" | "final";
export const curated = [
  {
    id: 2215207097,
    title: "Порічка",
    artist: "YAKTAK & KOLA",
    mood: "Українські хіти",
    color: "#ec8b95",
  },
  {
    id: 2073411437,
    title: "Плакала",
    artist: "KAZKA",
    mood: "Знають усі",
    color: "#8c81d8",
  },
  {
    id: 106348932,
    title: "Обійми",
    artist: "Океан Ельзи",
    mood: "Співаємо разом",
    color: "#657b99",
  },
];
export const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
// Clock is always audio.currentTime + offset, never a free-running timer.
export function activeCue(cues: Cue[], timeMs: number): number {
  let lo = 0,
    hi = cues.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid].startMs <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && timeMs < cues[found].endMs ? found : -1;
}
export function parseLRC(raw: string): Cue[] {
  const cues: Cue[] = [];
  const globalOffset = Number(raw.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0);
  for (const row of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const times = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const content = row.replace(/\[[^\]]*\]/g, "");
    const text = content.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "").trim();
    if (!text) continue;
    for (const match of times) {
      if (+match[2] >= 60) continue;
      const startMs = Math.max(
        0,
        +match[1] * 60000 +
          +match[2] * 1000 +
          Number((match[3] ?? "").padEnd(3, "0")) +
          globalOffset,
      );
      const words = [
        ...content.matchAll(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g),
      ]
        .filter((w) => +w[2] < 60 && w[4].trim())
        .map((w) => ({
          startMs: Math.max(
            0,
            +w[1] * 60000 +
              +w[2] * 1000 +
              Number((w[3] ?? "").padEnd(3, "0")) +
              globalOffset,
          ),
          endMs: 0,
          text: w[4],
        }));
      // Enhanced LRC word timestamps are absolute. Repeated line tags cannot
      // safely share a word timeline, so those lines keep exact line sync.
      const validWords =
        times.length === 1 &&
        words.length > 0 &&
        words.every(
          (w, i) =>
            w.startMs >= startMs && (!i || w.startMs > words[i - 1].startMs),
        );
      cues.push({
        startMs,
        endMs: startMs + 4000,
        text,
        ...(validWords ? { words } : {}),
      });
    }
  }
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues
    .filter((c, i) => i === 0 || c.startMs !== cues[i - 1].startMs)
    .map((cue, i, list) => {
      const endMs =
        list[i + 1]?.startMs ??
        Math.max(cue.startMs + 6000, (cue.words?.at(-1)?.startMs ?? 0) + 1500);
      const words = cue.words?.every((w) => w.startMs < endMs)
        ? cue.words.map((w, wi, ws) => ({
            ...w,
            endMs: ws[wi + 1]?.startMs ?? endMs,
          }))
        : undefined;
      return {
        ...cue,
        endMs,
        ...(words?.length ? { words } : { words: undefined }),
      };
    });
}
export async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      "Музичний сервер недоступний. Перевір з’єднання та спробуй ще раз.",
    );
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error("Музичний сервер не відповідає. Спробуй ще раз.");
  }
  if (!res.ok)
    throw new Error(body.error || "Не вдалося з’єднатися із сервером.");
  return body;
}

export type Session = {
  scores: Record<Team, number>;
  team: Team;
  round: number;
  trackId: number;
  offset: number;
  aligned: boolean;
  target: number;
  names: Record<Team, string>;
  rounds: number;
  answerSeconds: number;
  history: RoundRecord[];
  finished: boolean;
};
export type RoundRecord = {
  round: number;
  team: Team;
  awarded: Team | null;
  track: string;
  line: string;
  trackId: number;
  target: number;
};
export const freshSession = (): Session => ({
  scores: { girls: 0, boys: 0 },
  team: "girls",
  round: 1,
  trackId: curated[0].id,
  offset: 0,
  aligned: false,
  target: 3,
  names: { girls: "Дівчата", boys: "Хлопці" },
  rounds: 8,
  answerSeconds: 20,
  history: [],
  finished: false,
});
export function restoreSession(): Session {
  try {
    const s = JSON.parse(localStorage.getItem("khz:studio:v1") || "null");
    if (
      !s ||
      !["girls", "boys"].includes(s.team) ||
      !Number.isFinite(s.round) ||
      s.round < 1 ||
      !Number.isFinite(s.trackId)
    )
      return freshSession();
    if (
      !Number.isFinite(s.scores?.girls) ||
      s.scores.girls < 0 ||
      !Number.isFinite(s.scores?.boys) ||
      s.scores.boys < 0 ||
      !Number.isFinite(s.offset) ||
      !Number.isInteger(s.target) ||
      s.target < 0
    )
      return freshSession();
    return {
      ...freshSession(),
      ...s,
      finished: s.finished === true,
      rounds: [4, 8, 12, 16].includes(s.rounds) ? s.rounds : 8,
      answerSeconds: [15, 20, 30, 45].includes(s.answerSeconds)
        ? s.answerSeconds
        : 20,
      history: Array.isArray(s.history)
        ? s.history
            .filter(
              (r: RoundRecord) =>
                Number.isInteger(r.round) &&
                r.round >= 1 &&
                ["girls", "boys"].includes(r.team) &&
                (r.awarded === null || ["girls", "boys"].includes(r.awarded)) &&
                typeof r.track === "string" &&
                typeof r.line === "string" &&
                Number.isFinite(r.trackId) &&
                Number.isInteger(r.target),
            )
            .slice(0, 16)
        : [],
      names: {
        girls: String(s.names?.girls || "Дівчата").slice(0, 32),
        boys: String(s.names?.boys || "Хлопці").slice(0, 32),
      },
    };
  } catch {
    return freshSession();
  }
}
