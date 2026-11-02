import { Check, CheckCheck, Users, X, Monitor, Smartphone } from "lucide-react";
import { Button } from "./ui";
import type { PartyView } from "../lib/party";

export default function PartyVote({
  state,
  online,
  pending,
  action,
}: {
  state: PartyView;
  online: boolean;
  pending: boolean;
  action: (name: string, payload?: Record<string, unknown>) => boolean;
}) {
  const poll = state.round?.voting;
  if (!poll) return null;
  const canVote = online && !state.paused && poll.canVote;
  return (
    <div
      className={`team-voting ${poll.mode === "players" ? "collective-voting" : ""}`}
    >
      {poll.mode === "players" ? (
        <>
          <div className="poll-progress">
            <Users size={17} />
            <span>ПРОГОЛОСУВАЛИ</span>
            <strong>
              {poll.cast}
              <i>/</i>
              {poll.eligible}
            </strong>
          </div>
          <div className="poll-bars" aria-hidden="true">
            {Array.from({ length: poll.eligible }, (_, i) => (
              <span key={i} className={i < poll.cast ? "voted" : ""} />
            ))}
          </div>
          <p>Виграє більшість отриманих голосів. За нічиєї — без балів.</p>
        </>
      ) : (
        <p>
          {poll.fallback
            ? "У цій команді немає підключених гравців. Відповідь підтверджує ведучий."
            : "Порадьтеся командою й дайте одну відповідь."}
        </p>
      )}
      {canVote && (
        <>
          <div className="truth-options">
            <Button
              aria-pressed={poll.yourVote === true}
              className={poll.yourVote === true ? "voted-choice" : ""}
              disabled={pending}
              onClick={() => action("vote", { truth: true })}
            >
              <Check size={23} />
              Правда
            </Button>
            <Button
              aria-pressed={poll.yourVote === false}
              className={poll.yourVote === false ? "voted-choice" : ""}
              disabled={pending}
              onClick={() => action("vote", { truth: false })}
            >
              <X size={23} />
              Брехня
            </Button>
          </div>
          {poll.yourVote !== undefined && (
            <span className="vote-received">
              <CheckCheck size={16} />
              Голос прийнято. Можна змінити, поки голосування триває.
            </span>
          )}
        </>
      )}
      {!canVote &&
        poll.mode === "players" &&
        state.you &&
        !state.you.host &&
        state.you.team === state.activeTeam && (
          <p className="vote-waiting">
            Ти приєднаєшся до голосування з наступного раунду своєї команди.
          </p>
        )}
    </div>
  );
}

export function VoteModePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: "team" | "players";
  onChange: (v: "team" | "players") => void;
  disabled?: boolean;
}) {
  return (
    <div className="field-label vote-mode-picker">
      Як відповідає команда?
      <div className="vote-mode-options">
        <Button
          disabled={disabled}
          aria-pressed={value === "team"}
          className={value === "team" ? "selected" : ""}
          onClick={() => onChange("team")}
        >
          <Monitor size={19} />
          <span>
            Одна спільна відповідь<small>Для гри з одного екрана</small>
          </span>
        </Button>
        <Button
          disabled={disabled}
          aria-pressed={value === "players"}
          className={value === "players" ? "selected" : ""}
          onClick={() => onChange("players")}
        >
          <Smartphone size={19} />
          <span>
            Голосують телефони<small>Кожен гравець має голос</small>
          </span>
        </Button>
      </div>
    </div>
  );
}
