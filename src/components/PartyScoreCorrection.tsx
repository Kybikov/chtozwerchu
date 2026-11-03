import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "./ui";
import type { PartyResult } from "../lib/party";
import type { Team } from "../lib/music";

export default function PartyScoreCorrection({
  result,
  names,
  disabled,
  onCancel,
  onSave,
}: {
  result: PartyResult;
  names: Record<Team, string>;
  disabled: boolean;
  onCancel: () => void;
  onSave: (team: Team, points: number, revision: number) => void;
}) {
  const limit = result.awardLimit || 0;
  const [team, setTeam] = useState<Team | null>(
    result.points > 0 ? result.team : null,
  );
  const [points, setPoints] = useState(result.points || limit);
  const [revision] = useState(result.correctionRevision || 0);
  const stale = revision !== (result.correctionRevision || 0);
  return (
    <form
      className="party-score-correction"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && !stale)
          onSave(team || result.team, team ? points : 0, revision);
      }}
    >
      <div
        className="party-correction-teams"
        role="group"
        aria-label="Кому зарахувати бали"
      >
        {(["girls", "boys"] as Team[]).map((t) => (
          <Button
            key={t}
            aria-pressed={team === t}
            className={`award-${t}`}
            disabled={disabled || limit < 1}
            onClick={() => setTeam(t)}
          >
            {names[t]}
          </Button>
        ))}
        <Button
          aria-pressed={team === null}
          disabled={disabled}
          onClick={() => setTeam(null)}
        >
          Без балів
        </Button>
      </div>
      <div className="party-correction-points">
        <Button
          aria-label="Зменшити бали"
          disabled={disabled || !team || points <= 1}
          onClick={() => setPoints((p) => p - 1)}
        >
          <Minus size={22} />
        </Button>
        <output aria-live="polite">
          <strong>{team ? points : 0}</strong>
          <span>Максимум: {limit}</span>
        </output>
        <Button
          aria-label="Збільшити бали"
          disabled={disabled || !team || points >= limit}
          onClick={() => setPoints((p) => p + 1)}
        >
          <Plus size={22} />
        </Button>
      </div>
      <p>
        {stale
          ? "Оцінку вже змінено. Закрий це вікно й перевір актуальні бали."
          : "Зміна стосується лише цього конкурсу. Після переходу до наступного результат фіксується."}
      </p>
      <div className="dialog-actions">
        <Button onClick={onCancel}>Скасувати</Button>
        <Button type="submit" variant="primary" disabled={disabled || stale}>
          <Check size={20} />
          Зберегти бали
        </Button>
      </div>
    </form>
  );
}
