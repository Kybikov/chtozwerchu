import { useState } from "react";
import { ArrowRight, Check, Disc3, Trash2 } from "lucide-react";
import { Button, Panel } from "./ui";
import AlbumCover from "./AlbumCover";
import { formatTime } from "../lib/music";
import { preparedLimit, type PreparedSummary } from "../lib/preparedSongs";
import "../prepared-songs.css";

export default function PreparedSongs({
  songs,
  total = songs.length,
  busy = false,
  onLoad,
  onRemove,
  onClearSearch,
}: {
  songs: PreparedSummary[];
  total?: number;
  busy?: boolean;
  onLoad: (id: number) => void;
  onRemove?: (id: number) => Promise<void>;
  onClearSearch?: () => void;
}) {
  const [removing, setRemoving] = useState<number | null>(null);
  if (!total) return null;
  return (
    <section className="prepared-songs" aria-label="Підготовлені пісні">
      <div className="prepared-heading">
        <span className="section-label">
          <Check size={16} />
          ГОТОВІ ДО ГРИ
        </span>
        <span role="status">
          {songs.length === total
            ? `${total} / ${preparedLimit}`
            : `${songs.length} з ${total}`}
        </span>
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
                <AlbumCover src={song.cover} loading="lazy" size={28} />
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
      {!songs.length && (
        <div className="empty-state">
          <p>
            Серед підготовлених пісень збігів немає. Спробуй іншу назву або
            виконавця.
          </p>
          {onClearSearch && (
            <Button onClick={onClearSearch}>Показати всі підготовлені</Button>
          )}
        </div>
      )}
    </section>
  );
}
