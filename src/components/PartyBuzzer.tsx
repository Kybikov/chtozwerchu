import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Headphones,
  Lightbulb,
  Monitor,
  Pause,
  Play,
  SkipForward,
  X,
  Zap,
} from "lucide-react";
import { Button } from "./ui";
import type { PartyView } from "../lib/party";
import type { Team } from "../lib/music";

type Props = {
  state: PartyView;
  online: boolean;
  pending: boolean;
  action: (name: string, payload?: Record<string, unknown>) => boolean;
};
const teams: Team[] = ["girls", "boys"];

export function BuzzerScene({
  state,
  controls,
}: {
  state: PartyView;
  controls?: ReactNode;
}) {
  const b = state.round?.buzzer;
  if (!b) return null;
  return (
    <div
      className={`buzzer-scene ${b.phase} ${b.team || ""}`}
      aria-live="polite"
    >
      <img
        className="music-stage-art"
        src="/show-vinyl.webp"
        alt=""
        width="1536"
        height="1024"
        decoding="async"
      />
      <span className="section-label">
        {b.phase === "answer" ? "ПЕРШІ НА КНОПЦІ" : "ВПІЗНАЄШ? НЕ ВАГАЙСЯ."}
      </span>
      <h3>
        {b.phase === "answer" && b.team
          ? state.teams[b.team].name
          : "ХТО ЗНАЄ ЦЕЙ ХІТ?"}
      </h3>
      <p>
        {b.phase === "answer"
          ? `${b.playerName} на кнопці. Назвіть пісню або виконавця.`
          : "Перший натиск — ваші 10 секунд на відповідь."}
      </p>
      {controls || (
        <div className="buzzer-team-status">
          {teams.map((t) => (
            <span
              key={t}
              className={`${t} ${b.blocked.includes(t) ? "exhausted" : b.team === t ? "claimed" : ""}`}
            >
              <i />
              {state.teams[t].name}
              <small>
                {b.blocked.includes(t)
                  ? "ШАНС ВИКОРИСТАНО"
                  : b.team === t
                    ? "ВІДПОВІДАЮТЬ"
                    : "ГОТОВІ"}
              </small>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function useBuzzerShortcuts({
  state: s,
  online,
  pending,
  action,
}: Omit<Props, "state"> & { state: PartyView | null }) {
  const b = s?.round?.buzzer;
  const host = !!s?.you?.host;
  const open =
    !!b &&
    s?.stage === "playing" &&
    online &&
    !s.paused &&
    b.phase === "open" &&
    !s.round?.awaitingAudio;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        pending ||
        !open ||
        !b
      )
        return;
      if (
        document.querySelector('[role="dialog"]') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, a, [contenteditable="true"]',
          ))
      )
        return;
      if (
        event.code === "Space" &&
        event.target instanceof Element &&
        event.target.closest("button")
      )
        return;
      if (host && (event.code === "Digit1" || event.code === "Digit2")) {
        const team: Team = event.code === "Digit1" ? "girls" : "boys";
        if (!b.blocked.includes(team)) {
          event.preventDefault();
          action("buzz", { team });
        }
      } else if (!host && b.canBuzz && event.code === "Space") {
        event.preventDefault();
        action("buzz");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, pending, host, b, action]);
}

export function HostBuzzButtons({ state: s, online, pending, action }: Props) {
  const b = s.round?.buzzer;
  if (!s.you?.host || s.stage !== "playing" || !b || b.phase === "answer")
    return null;
  const open =
    online && !s.paused && b.phase === "open" && !s.round?.awaitingAudio;
  return (
    <div className="host-buzz-buttons">
      {teams.map((t, i) => (
        <Button
          key={t}
          className={`buzz-button ${t}`}
          disabled={!open || pending || b.blocked.includes(t)}
          onClick={() => action("buzz", { team: t })}
        >
          <Zap size={24} />
          <span>
            {s.teams[t].name}
            <small>
              {b.blocked.includes(t) ? "Шанс використано" : "Знаємо пісню"}
            </small>
          </span>
          <kbd>{i + 1}</kbd>
        </Button>
      ))}
    </div>
  );
}

export default function PartyBuzzer({
  state: s,
  online,
  pending,
  action,
}: Props) {
  const b = s.round?.buzzer;
  const [guess, setGuess] = useState("");
  useEffect(() => setGuess(""), [s.roundIndex, b?.attempt, b?.phase]);
  const host = !!s.you?.host;
  const open =
    !!b && online && !s.paused && b.phase === "open" && !s.round?.awaitingAudio;
  const answer = !!b && online && !s.paused && b.canAnswer;

  if (!b) return null;
  return (
    <div className={`party-buzzer-control ${s.you?.team || ""}`}>
      <div className="section-label">
        <Zap size={17} />
        ХТО ПЕРШИЙ — ТОЙ ВІДПОВІДАЄ
      </div>
      {b.phase === "answer" && b.team ? (
        <div className={`buzzer-claim ${b.team}`}>
          <span>ПРАВО ВІДПОВІДІ</span>
          <h3>{s.teams[b.team].name}</h3>
          <p>{b.playerName} · 10 секунд на хіт</p>
        </div>
      ) : (
        <p>
          {b.phase === "handoff"
            ? `${b.notice} Зараз шанс суперників. Ведучий продовжить фрагмент.`
            : s.paused
              ? s.round?.previewStatus === "unavailable"
                ? "Прев’ю недоступне. Ведучий може наспівати мотив або пропустити цю мелодію."
                : "Кнопки відкриються разом із музикою."
              : "Впізнали хіт? Тисніть. Першій команді — 10 секунд на відповідь."}
        </p>
      )}
      {b.phase !== "answer" &&
        (host ? (
          <HostBuzzButtons
            state={s}
            online={online}
            pending={pending}
            action={action}
          />
        ) : b.blocked.includes(s.you?.team || "girls") ? (
          <div className="buzzer-spent">
            <Check size={19} />
            Ваш шанс уже зіграно. Слухаємо суперників.
          </div>
        ) : (
          <Button
            className={`buzz-button player-buzz ${s.you?.team}`}
            disabled={!open || !b.canBuzz || pending}
            onClick={() => action("buzz")}
          >
            <Zap size={32} fill="currentColor" />
            <span>
              ЗНАЮ ПІСНЮ<small>Натисни або пробіл</small>
            </span>
          </Button>
        ))}
      {b.phase === "answer" && !answer && (
        <p className="buzzer-waiting">
          {s.paused
            ? "Відлік відповіді на паузі."
            : "Слухаємо відповідь. Наступний шанс — після рішення."}
        </p>
      )}
      {answer && (
        <>
          {host && (
            <div className="verdict-buttons">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => action("force", { won: true })}
              >
                <Check size={20} />
                Так, це хіт
              </Button>
              <Button
                disabled={pending}
                onClick={() => action("force", { won: false })}
              >
                <X size={20} />
                {b.blocked.length ? "Ні — завершуємо" : "Ні — шанс суперникам"}
              </Button>
            </div>
          )}
          <form
            className="party-guess"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (guess.trim() && action("guess", { text: guess.trim() }))
                setGuess("");
            }}
          >
            <label className="field-label">
              Назва пісні або виконавець
              <input
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                maxLength={200}
                placeholder="Ваша відповідь…"
                disabled={pending}
              />
            </label>
            <Button
              type="submit"
              aria-label="Надіслати відповідь"
              disabled={!guess.trim() || pending}
            >
              <ArrowRight size={20} />
            </Button>
          </form>
        </>
      )}
      {host && (
        <div className="buzzer-tools">
          <Button
            variant="primary"
            disabled={
              !online ||
              pending ||
              s.media?.pending ||
              (s.paused &&
                b.phase !== "answer" &&
                !s.media?.ready &&
                s.round?.previewStatus !== "unavailable")
            }
            onClick={() => action(s.paused ? "resume" : "pause")}
          >
            {s.paused ? <Play size={18} /> : <Pause size={18} />}
            {s.round?.awaitingAudio
              ? s.round.previewStatus === "unavailable"
                ? "Грати з наспівом ведучого"
                : "Увімкнути мелодію"
              : s.paused
                ? b.phase === "handoff"
                  ? "Продовжити для суперників"
                  : "Продовжити гру"
                : "Пауза гри"}
          </Button>
          <Button
            variant="ghost"
            disabled={!open || pending || (s.round?.hints?.length || 0) >= 2}
            onClick={() => action("hint")}
          >
            <Lightbulb size={17} />
            Підказка · менше балів
          </Button>
          <Button
            variant="ghost"
            disabled={!online || pending}
            onClick={() => action("end_melody")}
          >
            <SkipForward size={17} />
            Пропустити цю мелодію
          </Button>
        </div>
      )}
    </div>
  );
}

export function MelodyModePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: "team" | "buzzer";
  onChange: (v: "team" | "buzzer") => void;
  disabled?: boolean;
}) {
  return (
    <div className="field-label">
      Як вгадуємо мелодії?
      <div className="vote-mode-options melody-mode-options">
        <Button
          disabled={disabled}
          aria-pressed={value === "buzzer"}
          className={value === "buzzer" ? "selected" : ""}
          onClick={() => onChange("buzzer")}
        >
          <Zap size={19} />
          <span>
            Наввипередки<small>Кнопки для обох команд</small>
          </span>
        </Button>
        <Button
          disabled={disabled}
          aria-pressed={value === "team"}
          className={value === "team" ? "selected" : ""}
          onClick={() => onChange("team")}
        >
          <Headphones size={19} />
          <span>
            По черзі<small>Один хід — одна команда</small>
          </span>
        </Button>
      </div>
      <span className="melody-mode-note">
        <Monitor size={14} />З одного екрана кнопки натискає ведучий. Гравці
        можуть приєднатися з телефонів.
      </span>
    </div>
  );
}
