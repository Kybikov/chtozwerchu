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
      "Обговоріть факт. Спільна відповідь або голоси гравців визначать результат за 25 секунд.",
    short: "Несподівані факти",
  },
] as const;
export type Contest = (typeof contests)[number]["id"];
export type PartyResult = {
  voting?: {
    eligible: number;
    cast: number;
    truth: number;
    lie: number;
    decision?: boolean;
    outcome: "majority" | "tie" | "empty";
  };
  won: boolean;
  points: number;
  team: Team;
  answer: string;
  detail?: string;
};
export type PartyView = {
  serverTime: number;
  media?: PartyMedia;
  code: string;
  stage: "lobby" | "playing" | "result" | "final";
  config: {
    rounds: number;
    roundTypes: Contest[];
    preset: string;
    voteMode?: "team" | "players";
    melodyMode?: "team" | "buzzer";
  };
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
    buzzer?: {
      phase: "open" | "answer" | "handoff" | "closed";
      team?: Team;
      playerName?: string;
      attempt: number;
      blocked: Team[];
      canBuzz: boolean;
      canAnswer: boolean;
      notice?: string;
    };
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
    voting?: {
      mode: "team" | "players";
      eligible: number;
      cast: number;
      canVote: boolean;
      yourVote?: boolean;
      fallback?: boolean;
      result?: PartyResult["voting"];
    };
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
export type PartyMedia = {
  output: "host" | "tv";
  connected: boolean;
  tvConnected: boolean;
  enabled: boolean;
  ready: boolean;
  playing: boolean;
  pending: boolean;
  wanted: boolean;
  position: number;
  duration: number;
  volume: number;
  revision: number;
  notice?: string;
};

export { useParty } from "./partyConnection";
const pointPlurals = new Intl.PluralRules("uk");
export function pointWord(value: number) {
  const form = pointPlurals.select(value);
  return form === "one" ? "бал" : form === "few" ? "бали" : "балів";
}
