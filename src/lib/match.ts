import type { Cue, RoundRecord, Session } from "./music";

export function scoreRound(session: Session, result: RoundRecord): Session {
  if (
    result.round !== session.round ||
    session.history.some((r) => r.round === result.round)
  )
    return session;
  return {
    ...session,
    scores: {
      ...session.scores,
      ...(result.awarded
        ? { [result.awarded]: session.scores[result.awarded] + 3 }
        : {}),
    },
    history: [...session.history, result],
  };
}

export function undoRound(session: Session): Session {
  const last = session.history.at(-1);
  if (!last || last.round !== session.round) return session;
  return {
    ...session,
    history: session.history.slice(0, -1),
    scores: {
      ...session.scores,
      ...(last.awarded
        ? { [last.awarded]: Math.max(0, session.scores[last.awarded] - 3) }
        : {}),
    },
  };
}

export function nextPlayableTarget(
  cues: Cue[],
  offset: number,
  duration: number,
  after: number,
  used: number[],
): number | null {
  const available = cues
    .map((c, i) => ({ i, stop: (c.startMs - offset) / 1000 }))
    .filter(
      (c) => c.stop > 0.3 && c.stop < duration - 0.2 && !used.includes(c.i),
    );
  return available.find((c) => c.i > after)?.i ?? available[0]?.i ?? null;
}

export function matchWinner(scores: Session["scores"]) {
  return scores.girls === scores.boys
    ? null
    : scores.girls > scores.boys
      ? "girls"
      : "boys";
}
