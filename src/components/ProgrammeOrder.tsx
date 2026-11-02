import { Check, Disc3, Music2 } from "lucide-react";
import type { Programme } from "../lib/programme";
import type { PreparedSummary } from "../lib/preparedSongs";

export default function ProgrammeOrder({
  programme,
  songs,
  round,
}: {
  programme: Programme;
  songs: PreparedSummary[];
  round: number;
}) {
  return (
    <ol
      className="programme-order programme-running"
      aria-label="Програма раундів"
    >
      {programme.trackIds.map((id, index) => {
        const song = songs.find((s) => s.id === id),
          current = index === round - 1,
          played = index < round - 1;
        return (
          <li
            key={id}
            aria-current={current ? "step" : undefined}
            className={
              current ? "programme-current" : played ? "programme-played" : ""
            }
          >
            <span
              className={`programme-number ${index % 2 ? "boys" : "girls"}`}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="programme-song-copy">
              <strong>{song?.title ?? `Пісня ${index + 1}`}</strong>
              <span>{song?.artist ?? "Підготовлений запис на сцені"}</span>
            </div>
            <span className="programme-progress">
              {played ? (
                <Check size={18} />
              ) : current ? (
                <Music2 size={18} />
              ) : (
                <Disc3 size={18} />
              )}{" "}
              {played ? "Зіграно" : current ? "Зараз" : "Попереду"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
