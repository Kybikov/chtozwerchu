import { useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import BlurText from "./react-bits/BlurText/BlurText";
import CountUp from "./react-bits/CountUp/CountUp";
import type { Team } from "../lib/music";
import "../final-showcase.css";

export default function FinalShowcase({
  names,
  scores,
  winner,
  caption,
}: {
  names: Record<Team, string>;
  scores: Record<Team, number>;
  winner: Team | null;
  caption: string;
}) {
  const reduced = useReducedMotion();
  const title = winner ? "ЗВЕРХУ —" : "НІЧИЯ!";
  const digits = Math.max(String(scores.girls).length, String(scores.boys).length);
  return (
    <div className={`final-showcase-shell finale-${winner || "tie"}`}>
      <section className="final-showcase" aria-label="Фінальний результат">
        <div className="finale-art" aria-hidden="true">
          <img
            src="/show-trophy-v1.webp"
            width="1280"
            height="1280"
            alt=""
            decoding="async"
          />
        </div>
        <div className="finale-copy">
          <p className="finale-eyebrow">ЦЕЙ ВЕЧІР ВИ ЗРОБИЛИ</p>
          <h2 className="finale-title">
            {reduced ? title : (
              <BlurText text={title} animateBy="words" trigger="load" delay={60} />
            )}
          </h2>
          <p className="finale-winner">
            {winner ? names[winner] : "Сьогодні зверху всі."}
          </p>
          <dl
            className="finale-scores"
            aria-label="Підсумковий рахунок"
            style={{ "--final-digits": digits } as CSSProperties}
          >
            {(["girls", "boys"] as Team[]).map((team) => (
              <div key={team} className={`finale-score finale-score-${team}`}>
                <dt>{names[team]}</dt>
                <dd>
                  {reduced ? scores[team] : (
                    <CountUp to={scores[team]} duration={0.65} trigger="load" />
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="finale-caption">{caption}</p>
        </div>
      </section>
    </div>
  );
}
