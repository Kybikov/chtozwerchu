export type Cue = { startMs: number; endMs: number; text: string };
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
export type Phase = "ready" | "playing" | "answer" | "result";
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
    const text = row.replace(/\[[^\]]*\]/g, "").trim();
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
      cues.push({ startMs, endMs: startMs + 4000, text });
    }
  }
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues
    .filter((c, i) => i === 0 || c.startMs !== cues[i - 1].startMs)
    .map((cue, i, list) => ({
      ...cue,
      endMs: list[i + 1]?.startMs ?? cue.startMs + 6000,
    }));
}
export async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal });
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
      names: {
        girls: String(s.names?.girls || "Дівчата").slice(0, 32),
        boys: String(s.names?.boys || "Хлопці").slice(0, 32),
      },
    };
  } catch {
    return freshSession();
  }
}
