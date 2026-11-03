import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AudioLines, Maximize2, Music2, Trophy } from "lucide-react";
import { Button, Panel } from "./ui";
import CountUp from "./react-bits/CountUp/CountUp";
import BlurText from "./react-bits/BlurText/BlurText";
import type { ShowState } from "../lib/show";
import type { Team } from "../lib/music";
import { matchWinner } from "../lib/match";
import FinalShowcase from "./FinalShowcase";

export function Scoreboard({ state }: { state: ShowState }) {
  return (
    <div className="scoreboard">
      {(["girls", "boys"] as Team[]).map((team, i) => (
        <div
          key={team}
          className={`team-score ${team} ${(state.phase === "final" ? matchWinner(state.scores) === team : state.team === team) ? "team-active" : ""}`}
        >
          <div className="team-avatar" aria-hidden="true">
            {i === 0 ? "↗" : "↖"}
          </div>
          <div className="team-meta">
            <span className="micro-label">КОМАНДА 0{i + 1}</span>
            <strong>{state.names[team]}</strong>
            <span className="team-turn">
              {state.phase === "final"
                ? "Фінальний рахунок"
                : state.team === team
                  ? "Зараз ваш вихід"
                  : "Готуйтесь до реваншу"}
            </span>
          </div>
          <span className="score-number">
            <CountUp to={state.scores[team]} duration={0.5} trigger="load" />
          </span>
        </div>
      ))}
      <div className="versus">VS</div>
    </div>
  );
}

export default function ShowStage({
  state,
  onExpand,
}: {
  state: ShowState;
  onExpand?: () => void;
}) {
  const reduced = useReducedMotion();
  const winner = matchWinner(state.scores);
  return (
    <Panel className={`show-stage phase-${state.phase}`}>
      <div className="stage-topline">
        <span className="round-tag">
          <Music2 size={18} />
          {state.phase === "final" ? "ФІНАЛ ШОУ" : "ПРОДОВЖ ПІСНЮ"}
        </span>
        {state.eventName && (
          <span className="stage-event">{state.eventName}</span>
        )}
        {onExpand && (
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Збільшити сцену"
            onClick={onExpand}
          >
            <Maximize2 size={20} />
          </Button>
        )}
      </div>
      <div className="stage-grid" aria-hidden="true" />
      <AnimatePresence mode="wait">
        <motion.div
          className="stage-content"
          key={state.phase}
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -12 }}
          transition={{ duration: reduced ? 0 : 0.3 }}
        >
          {state.phase === "ready" && (
            <>
              <img
                className="stage-sculpture"
                src="/show-vinyl.webp"
                alt=""
                width="1536"
                height="1024"
                fetchPriority="high"
              />
              <div className="ready-copy">
                <p className="stage-kicker">
                  <span className="live-dot" /> ТВОЯ КОМАНДА. ТВІЙ ПРИСПІВ.
                </p>
                <h2>
                  <BlurText
                    text="ЛОВИ РИТМ."
                    delay={70}
                    trigger="load"
                    className="stage-blur"
                  />
                  <span className="gradient-type">
                    ЗАБИРАЙ
                    <br />
                    ПЕРЕМОГУ.
                  </span>
                </h2>
                <p className="stage-caption">
                  Музика стихне.
                  <br />А ви продовжите.
                </p>
                <div className="stage-pills">
                  <span>
                    <AudioLines size={16} />2 команди
                  </span>
                  <span>+3 бали за хіт</span>
                </div>
              </div>
            </>
          )}
          {state.phase === "playing" && (
            <>
              <div
                className={`equalizer ${state.playing ? "is-playing" : ""}`}
                aria-hidden="true"
              >
                {Array.from({ length: 25 }, (_, i) => (
                  <i key={i} style={{ "--bar": i } as React.CSSProperties} />
                ))}
              </div>
              <p className="stage-kicker">
                {state.playing ? "СЛУХАЙ УВАЖНО" : "МУЗИКА НА ПАУЗІ"}
              </p>
              <h2 className="lyric-live">
                {state.words?.length
                  ? state.words.map((w, i) => (
                      <span
                        key={i}
                        className={
                          state.nowMS >= w.startMs
                            ? state.nowMS < w.endMs
                              ? "word-active"
                              : "word-sung"
                            : "word-next"
                        }
                      >
                        {w.text}
                      </span>
                    ))
                  : state.lyric || "Лови знайомі ноти…"}
              </h2>
              <p className="stage-caption">
                {state.names[state.team]}, наступний рядок — за вами.
              </p>
            </>
          )}
          {state.phase === "answer" && (
            <>
              <div
                className={`answer-clock ${state.remaining === 0 ? "clock-expired" : ""}`}
                role="timer"
                aria-label="Час на відповідь"
              >
                <span>{String(state.remaining).padStart(2, "0")}</span>
                <small>
                  {state.remaining === 0
                    ? "ЧАС ВИЙШОВ"
                    : state.timerPaused
                      ? "ПАУЗА"
                      : "СЕКУНД НА ХІТ"}
                </small>
              </div>
              <p className="stage-kicker">А ТЕПЕР — ВАШ ВИХІД</p>
              <h2 className="answer-title">
                ЩО БУЛО <span className="gradient-type">ДАЛІ?</span>
              </h2>
              <p className="stage-caption">
                {state.names[state.team]}, продовжуйте пісню!
              </p>
              <div className="hidden-words" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} />
                ))}
              </div>
            </>
          )}
          {state.phase === "result" && (
            <>
              <div
                className={`stage-symbol result-symbol ${state.awarded ? "won" : ""}`}
              >
                <Trophy size={42} />
              </div>
              <p className="stage-kicker">
                {state.awarded ? "ЦЕ БУЛО КРАСИВО" : "ЩЕ ПОБОРЕМОСЬ"}
              </p>
              <h2>
                {state.awarded ? (
                  <>
                    <span className="gradient-type">+3 БАЛИ</span>
                    <span className="winner-name">
                      {state.names[state.awarded]}
                    </span>
                  </>
                ) : (
                  <>
                    ХІТ ІЗ <span className="gradient-type">ХАРАКТЕРОМ.</span>
                  </>
                )}
              </h2>
              <p className="revealed-line">«{state.answer}»</p>
              <p className="result-track">{state.track}</p>
            </>
          )}
          {state.phase === "final" && (
            <FinalShowcase
              names={state.names}
              scores={state.scores}
              winner={winner}
              caption="А реванш завжди починається з наступної гри."
            />
          )}
        </motion.div>
      </AnimatePresence>
      <div className="stage-bottomline">
        <span>
          РАУНД <b>{String(state.round).padStart(2, "0")}</b>
          <em> / {state.rounds}</em>
        </span>
        <span className={`stage-state state-${state.phase}`}>
          <span />
          {state.phase === "ready"
            ? "ГОТУЄМО СЦЕНУ"
            : state.phase === "playing"
              ? state.playing
                ? "ЗВУЧИТЬ ТРЕК"
                : "ПАУЗА"
              : state.phase === "answer"
                ? "ВАШ ЧАС"
                : state.phase === "final"
                  ? "ГРУ ЗАВЕРШЕНО"
                  : "РЕЗУЛЬТАТ"}
        </span>
        <span
          className={`active-team ${state.phase === "final" ? (winner ?? "girls") : state.team}`}
        >
          {state.phase === "final"
            ? winner
              ? state.names[winner]
              : "Зверху всі"
            : state.names[state.team]}
          <span>↗</span>
        </span>
      </div>
    </Panel>
  );
}
