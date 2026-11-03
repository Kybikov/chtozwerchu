import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  Disc3,
  ListMusic,
  LoaderCircle,
  Package,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button, Panel } from "./ui";
import AlbumCover from "./AlbumCover";
import PreparedSongs from "./PreparedSongs";
import { api, curated, formatTime, type Track } from "../lib/music";
import type { PreparedSummary } from "../lib/preparedSongs";
import { findPreparedSongs } from "../lib/librarySearch";
import "../track-library.css";

type Source = "prepared" | "deezer";

export default function TrackLibrary({
  songs,
  loaded,
  busy,
  onLoad,
  onLoadPrepared,
  onRemove,
  onProgramme,
  onPack,
}: {
  songs: PreparedSummary[];
  loaded: boolean;
  busy: boolean;
  onLoad: (id: number) => void;
  onLoadPrepared: (id: number) => void;
  onRemove: (id: number) => Promise<void>;
  onProgramme: () => void;
  onPack: () => void;
}) {
  const [selectedSource, setSource] = useState<Source | null>(null);
  const source =
    selectedSource ?? (!loaded || songs.length ? "prepared" : "deezer");
  const [preparedQuery, setPreparedQuery] = useState("");
  const [deezerQuery, setDeezerQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const query = source === "prepared" ? preparedQuery : deezerQuery;
  const setQuery = source === "prepared" ? setPreparedQuery : setDeezerQuery;
  const filtered = findPreparedSongs(songs, preparedQuery);
  const hasQuery = !!deezerQuery.trim();

  useEffect(() => {
    setResults([]);
    setError("");
    if (source !== "deezer" || !deezerQuery.trim()) {
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timeout = setTimeout(() => {
      void api<{ tracks: Track[] }>(
        `/api/music/search?q=${encodeURIComponent(deezerQuery.trim())}`,
        controller.signal,
      )
        .then((value) => {
          if (controller.signal.aborted) return;
          setResults(value.tracks);
          setSearching(false);
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          setError(
            e instanceof Error
              ? e.message
              : "Пошук недоступний. Спробуй ще раз.",
          );
          setSearching(false);
        });
    }, 350);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [source, deezerQuery]);

  return (
    <div className="library-browser">
      <div
        ref={tabs}
        className="library-sources"
        role="tablist"
        aria-label="Джерело пісень"
      >
        {(["prepared", "deezer"] as const).map((value) => (
          <Button
            key={value}
            data-source={value}
            role="tab"
            id={`${id}-${value}`}
            aria-selected={source === value}
            aria-controls={`${id}-songs`}
            tabIndex={source === value ? 0 : -1}
            variant={source === value ? "primary" : "ghost"}
            onClick={() => setSource(value)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next: Source =
                event.key === "Home"
                  ? "prepared"
                  : event.key === "End"
                    ? "deezer"
                    : value === "prepared"
                      ? "deezer"
                      : "prepared";
              setSource(next);
              tabs.current
                ?.querySelector<HTMLButtonElement>(`[data-source="${next}"]`)
                ?.focus();
            }}
          >
            {value === "prepared" ? (
              <>
                Підготовлені <span>{songs.length}</span>
              </>
            ) : (
              "Пошук Deezer"
            )}
          </Button>
        ))}
      </div>
      <label className="search-field library-search">
        <Search size={20} aria-hidden="true" />
        <input
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            source === "prepared"
              ? "Знайти серед підготовлених"
              : "Пісня або виконавець"
          }
          aria-label={
            source === "prepared"
              ? "Пошук підготовленої пісні"
              : "Пошук треку в Deezer"
          }
        />
        {query && (
          <Button
            variant="ghost"
            className="icon-button"
            onClick={() => setQuery("")}
            aria-label="Очистити пошук"
          >
            <X size={18} />
          </Button>
        )}
      </label>
      <div className="library-actions">
        <Button onClick={onProgramme}>
          <ListMusic size={18} /> Зібрати програму вечора{" "}
          <ArrowRight size={18} />
        </Button>
        <Button onClick={onPack}>
          <Package size={18} /> Перенести вечір на інший пристрій
        </Button>
      </div>
      <div
        id={`${id}-songs`}
        role="tabpanel"
        aria-labelledby={`${id}-${source}`}
        tabIndex={0}
      >
        {source === "prepared" ? (
          !loaded ? (
            <p className="library-status" role="status">
              <LoaderCircle size={18} className="spin" /> Відкриваємо
              підготовлені пісні…
            </p>
          ) : songs.length ? (
            <PreparedSongs
              songs={filtered}
              total={songs.length}
              busy={busy}
              onLoad={onLoadPrepared}
              onRemove={onRemove}
              onClearSearch={() => setPreparedQuery("")}
            />
          ) : (
            <div className="empty-state">
              <p>Тут будуть твої підготовлені пісні.</p>
              <p>
                Знайди трек, додай аудіо й перевір прив’язку тексту. Тоді
                збережи підготовку для гри.
              </p>
              <Button onClick={() => setSource("deezer")}>
                Знайти першу пісню <ArrowRight size={18} />
              </Button>
            </div>
          )
        ) : (
          <>
            <div className="library-caption" role="status">
              <span>
                {hasQuery
                  ? searching
                    ? "ШУКАЄМО ТРЕКИ…"
                    : error
                      ? "ПОШУК НЕДОСТУПНИЙ"
                      : `РЕЗУЛЬТАТИ ПОШУКУ · ${results.length}`
                  : "З ЦЬОГО МОЖНА ПОЧАТИ"}
              </span>
              {searching && <LoaderCircle size={18} className="spin" />}
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="track-library" aria-busy={searching}>
              {hasQuery
                ? results.map((track) => (
                    <Button
                      key={track.id}
                      variant="ghost"
                      className="library-result"
                      disabled={searching}
                      onClick={() => onLoad(track.id)}
                    >
                      <AlbumCover src={track.cover} />
                      <span>
                        <strong>{track.title}</strong>
                        <small>
                          {track.artist} · {track.album}
                        </small>
                      </span>
                      <span className="library-duration">
                        {formatTime(track.duration)}
                      </span>
                      <Plus size={17} />
                    </Button>
                  ))
                : curated.map((track, i) => (
                    <Panel className="curated-card" key={track.id}>
                      <div className={`curated-art art-${i}`}>
                        <Disc3 size={72} strokeWidth={0.7} />
                        <span>{String(i + 1).padStart(2, "0")}</span>
                      </div>
                      <span className="curated-mood">{track.mood}</span>
                      <h3>{track.title}</h3>
                      <p>{track.artist}</p>
                      <Button
                        className="full-width"
                        onClick={() => onLoad(track.id)}
                      >
                        Обрати трек <ArrowRight size={15} />
                      </Button>
                    </Panel>
                  ))}
            </div>
            {hasQuery && !searching && !error && !results.length && (
              <p className="empty-state">
                Не знайшли збігів. Спробуй іншу назву або виконавця.
              </p>
            )}
            <div className="library-footnote">
              <Disc3 size={16} />
              <span>
                Треки з Deezer. У прототипі доступні прев’ю; повний аудіофайл
                можна додати з пристрою.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
