import { useState } from "react";
import { ArrowRight, Check, Disc3, Trash2 } from "lucide-react";
import { Button, Panel } from "./ui";
import { formatTime } from "../lib/music";
import type { PreparedSummary } from "../lib/preparedSongs";
import "../prepared-songs.css";

export default function PreparedSongs({
  songs,
  busy = false,
  onLoad,
  onRemove,
}: {
  songs: PreparedSummary[];
  busy?: boolean;
  onLoad: (id: number) => void;
  onRemove?: (id: number) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<number | null>(null);
  if (!songs.length) return null;
  return (
    <section className="prepared-songs" aria-label="Підготовлені пісні">
      <div className="prepared-heading">
        <span className="section-label">
          <Check size={16} />
          ГОТОВІ ДО ГРИ
        </span>
        <span>{songs.length} / 40</span>
      </div>
      <p className="prepared-description">
        Власне аудіо й текст відкриваються з цього пристрою без мережі. Для
        прев’ю Deezer потрібне підключення.
      </p>
      <div className="prepared-list">
        {songs.map((song) => (
          <Panel className="prepared-card" key={song.id}>
            <div className="prepared-art" aria-hidden="true">
              {song.cover ? (
                <img src={song.cover} alt="" loading="lazy" />
              ) : (
                <Disc3 size={28} />
              )}
            </div>
            <div className="prepared-copy">
              <strong>{song.title}</strong>
              <span>{song.artist}</span>
              <small>
                {song.local
                  ? "Власне аудіо · без мережі"
                  : "Прев’ю · потрібна мережа"}{" "}
                · {formatTime(song.duration)}
              </small>
            </div>
            <Button
              className="prepared-load"
              disabled={busy}
              onClick={() => onLoad(song.id)}
              aria-label={`Відкрити підготовку ${song.title}`}
            >
              <ArrowRight size={20} />
            </Button>
            {onRemove && (
              <Button
                variant="ghost"
                className="prepared-remove"
                disabled={busy}
                aria-label={`Прибрати підготовку ${song.title}`}
                onClick={() => setRemoving(song.id)}
              >
                <Trash2 size={17} />
              </Button>
            )}
            {removing === song.id && onRemove && (
              <div className="prepared-confirm" role="alert">
                <p>
                  Прибрати збережену підготовку «{song.title}» разом із її
                  копією аудіо?
                </p>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void onRemove(song.id)
                      .then(() => setRemoving(null))
                      .catch(() => {})
                  }
                >
                  Прибрати
                </Button>
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() => setRemoving(null)}
                >
                  Залишити
                </Button>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </section>
  );
}
