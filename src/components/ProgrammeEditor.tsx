import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Disc3,
  ListMusic,
  Plus,
  Save,
  X,
} from "lucide-react";
import { Button, Panel } from "./ui";
import AlbumCover from "./AlbumCover";
import type { PreparedSummary } from "../lib/preparedSongs";
import {
  validProgramme,
  validProgrammeDraft,
  type Programme,
} from "../lib/programme";
import "../programme.css";

export default function ProgrammeEditor({
  initial,
  songs,
  busy,
  replacing,
  onSave,
  onStart,
}: {
  initial: Programme;
  songs: PreparedSummary[];
  busy: boolean;
  replacing: boolean;
  onSave: (programme: Programme) => Promise<void>;
  onStart: (programme: Programme) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Programme>(() => ({
    ...initial,
    trackIds: [...initial.trackIds],
  }));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const missing = draft.trackIds.some((id) => !songs.some((s) => s.id === id));
  const edit = (next: Programme) => {
    setDraft(next);
    setSaved(false);
    setConfirm(false);
    setError("");
  };
  const move = (index: number, direction: number) => {
    const ids = [...draft.trackIds],
      to = index + direction;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    edit({ ...draft, trackIds: ids });
  };
  const perform = async (start: boolean) => {
    setError("");
    try {
      if (start) await onStart(draft);
      else {
        await onSave(draft);
        setSaved(true);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не вдалося зберегти програму.",
      );
    }
  };
  return (
    <div className="programme-editor">
      <Panel className="programme-hero">
        <div className="programme-hero-copy">
          <span className="section-label">
            <ListMusic size={18} /> СЦЕНАРІЙ ТВОГО ШОУ
          </span>
          <h3>
            Весь вечір.
            <br />
            <span>У твоєму ритмі.</span>
          </h3>
          <p>
            Збери 4, 8, 12 або 16 підготовлених пісень. Один запис — один раунд.
            Наступну пісню сцена підготує після твоєї команди.
          </p>
        </div>
        <div
          className="programme-counter"
          aria-label={`Пісень у програмі: ${draft.trackIds.length}`}
        >
          <strong>{String(draft.trackIds.length).padStart(2, "0")}</strong>
          <span>ПІСЕНЬ / 16</span>
        </div>
      </Panel>
      <label className="programme-title">
        <span>Назва вечора</span>
        <input
          value={draft.title}
          maxLength={80}
          placeholder="Наприклад, весілля Олі та Макса"
          onChange={(e) => edit({ ...draft, title: e.target.value })}
          disabled={busy}
        />
      </label>
      <div className="programme-section-title">
        <strong>Порядок раундів</strong>
        <span>Порівну ходів для команд</span>
      </div>
      {!draft.trackIds.length && (
        <div className="programme-empty">
          <ListMusic size={34} />
          <p>Перший хіт задає тон вечору.</p>
          <span>Додай пісні зі списку нижче.</span>
        </div>
      )}
      <ol className="programme-order" aria-label="Порядок пісень">
        {draft.trackIds.map((id, index) => {
          const song = songs.find((s) => s.id === id);
          return (
            <li key={id} className={!song ? "programme-missing" : ""}>
              <span
                className={`programme-number ${index % 2 ? "boys" : "girls"}`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="programme-song-copy">
                <strong>{song?.title ?? "Підготовку прибрано"}</strong>
                <span>
                  {song?.artist ?? "Прибери цей запис або віднови підготовку."}
                </span>
              </div>
              <div className="programme-order-actions">
                <Button
                  variant="ghost"
                  disabled={busy || index === 0}
                  aria-label={`Підняти пісню ${index + 1}`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={18} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || index === draft.trackIds.length - 1}
                  aria-label={`Опустити пісню ${index + 1}`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={18} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Прибрати пісню ${index + 1} з програми`}
                  onClick={() =>
                    edit({
                      ...draft,
                      trackIds: draft.trackIds.filter((x) => x !== id),
                    })
                  }
                >
                  <X size={18} />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="programme-section-title">
        <strong>Додати до програми</strong>
        <span>З бібліотеки «Готові до гри»</span>
      </div>
      {!songs.length && (
        <p className="programme-hint">
          Спочатку підготуй пісні: обери запис, аудіо, текст і рядок, потім
          натисни «Зберегти підготовку» у студії.
        </p>
      )}
      <div className="programme-available">
        {songs.map((song) => {
          const included = draft.trackIds.includes(song.id);
          return (
            <Button
              key={song.id}
              variant="ghost"
              className="programme-add"
              disabled={busy || included || draft.trackIds.length >= 16}
              onClick={() =>
                edit({ ...draft, trackIds: [...draft.trackIds, song.id] })
              }
              aria-label={`Додати до програми ${song.title}`}
            >
              <span className="programme-cover" aria-hidden="true">
                {song.cover ? (
                  <AlbumCover src={song.cover} loading="lazy" size={24} />
                ) : (
                  <Disc3 size={24} />
                )}
              </span>
              <span className="programme-song-copy">
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </span>
              {included ? <Check size={20} /> : <Plus size={20} />}
            </Button>
          );
        })}
      </div>
      <div className="programme-footer">
        <p className="programme-hint">
          Чернетка зберігається на цьому пристрої. Запуск програми починає нову
          гру; звук вмикає ведучий.
        </p>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {missing && (
          <p role="alert" className="inline-error">
            У програмі є пісня без збереженої підготовки.
          </p>
        )}
        {!validProgramme(draft) && draft.trackIds.length > 0 && (
          <p className="programme-hint">
            Для початку потрібно рівно 4, 8, 12 або 16 пісень.
          </p>
        )}
        {confirm && (
          <div className="programme-replace" role="alert">
            <strong>Почати цей вечір з нуля?</strong>
            <p>
              Поточний рахунок і незавершена гра будуть замінені. Підготовлені
              пісні залишаться.
            </p>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void perform(true)}
            >
              Так, почати програму <ArrowRight size={18} />
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => setConfirm(false)}
            >
              Зберегти поточну гру
            </Button>
          </div>
        )}
        <div className="programme-main-actions">
          <Button
            disabled={busy || !validProgrammeDraft(draft)}
            onClick={() => void perform(false)}
          >
            <Save size={18} />
            {saved ? "Чернетку збережено" : "Зберегти чернетку"}
          </Button>
          <Button
            variant="primary"
            disabled={busy || missing || !validProgramme(draft) || confirm}
            onClick={() => (replacing ? setConfirm(true) : void perform(true))}
          >
            {busy ? "Готуємо вечір…" : "Почати програму"}
            <ArrowRight size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
}
