import { Check, Pause, Play } from "lucide-react";
import { Button } from "./ui";
import type { Team } from "../lib/music";

export default function RoundVerdictControls({
  names,
  remaining,
  paused,
  onToggle,
  onAward,
  showPrompt = true,
}: {
  names: Record<Team, string>;
  remaining: number;
  paused: boolean;
  onToggle: () => void;
  onAward: (team: Team | null) => void;
  showPrompt?: boolean;
}) {
  return (
    <div className="answer-controls">
      <div className="answer-timer-control">
        <strong>{remaining} с</strong>
        <Button onClick={onToggle} disabled={remaining === 0}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
          {paused ? "Продовжити відлік" : "Пауза відліку"}
        </Button>
      </div>
      {showPrompt && <span>Хто продовжив пісню?</span>}
      <div className="action-pair">
        {(["girls", "boys"] as Team[]).map((team) => (
          <Button
            key={team}
            className={`award-${team}`}
            onClick={() => onAward(team)}
          >
            <Check size={15} />
            <span className="verdict-team-name">{names[team]}</span>
          </Button>
        ))}
      </div>
      <Button
        variant="ghost"
        className="full-width"
        onClick={() => onAward(null)}
      >
        Цього разу ніхто
      </Button>
    </div>
  );
}
