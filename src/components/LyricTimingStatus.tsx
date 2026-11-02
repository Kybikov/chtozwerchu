import { AudioLines, Captions } from "lucide-react";
import type { Cue } from "../lib/music";
import { wordCoverage } from "../lib/lyricTimeline";
import "../lyric-timing.css";

export default function LyricTimingStatus({
  cues,
  imported = false,
}: {
  cues: Cue[];
  imported?: boolean;
}) {
  const coverage = wordCoverage(cues);
  if (!coverage.total) return null;
  return (
    <div
      className={`lyric-timing ${coverage.lines ? "has-words" : "line-only"}`}
      role="status"
    >
      <span className="lyric-timing-symbol" aria-hidden="true">
        {coverage.lines ? <AudioLines size={24} /> : <Captions size={24} />}
      </span>
      <div>
        <strong>
          {coverage.lines === coverage.total
            ? "Послівне підсвічування"
            : coverage.lines
              ? "Рядки та слова"
              : "Підсвічування рядками"}
        </strong>
        <p>
          {coverage.lines
            ? `${imported ? "Власні мітки" : "Мітки Deezer"} · ${coverage.lines} із ${coverage.total} рядків`
            : "Для цього запису немає міток окремих слів."}
        </p>
      </div>
      {coverage.lines > 0 && (
        <span className="lyric-timing-count">
          {coverage.words}
          <small>міток</small>
        </span>
      )}
    </div>
  );
}
