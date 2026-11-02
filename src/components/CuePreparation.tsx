import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  AudioLines,
  Check,
  Headphones,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  SkipBack,
  Upload,
} from "lucide-react";
import { Button } from "./ui";
import WakeSlider from "./react-bits/WakeSlider";
import { activeCue, formatTime, type Cue } from "../lib/music";
import type { usePlayer } from "../lib/usePlayer";
import { cueAudioRange } from "../lib/cueAudio";
import { timingCount } from "../lib/wordTiming";
import "../cue-preparation.css";

type Props = {
  cues: Cue[];
  player: ReturnType<typeof usePlayer>;
  offset: number;
  aligned: boolean;
  target: number;
  localAudio: boolean;
  imported: boolean;
  onAlign: (index: number) => void;
  onTarget: (index: number) => void;
  onWords: (index: number) => void;
  onOffset: (offset: number) => void;
  onOriginal: () => void;
  onImport: () => void;
  onExport: () => void;
  onProvider: () => void;
};

export default function CuePreparation({
  cues,
  player,
  offset,
  aligned,
  target,
  localAudio,
  imported,
  onAlign,
  onTarget,
  onWords,
  onOffset,
  onOriginal,
  onImport,
  onExport,
  onProvider,
}: Props) {
  const [query, setQuery] = useState("");
  const [audition, setAudition] = useState<number | null>(null);
  const range = useRef<{ start: number; end: number } | null>(null);
  const generation = useRef(0);
  const current = aligned
    ? activeCue(cues, player.position * 1000 + offset)
    : -1;
  const audioRef = player.ref;
  const stop = useCallback(() => {
    generation.current++;
    range.current = null;
    audioRef.current?.pause();
    setAudition(null);
  }, [audioRef]);

  useEffect(() => {
    stop();
    return () => {
      generation.current++;
      range.current = null;
      audioRef.current?.pause();
    };
  }, [offset, aligned, audioRef, stop]);

  useEffect(() => {
    if (audition === null) return;
    const audio = audioRef.current;
    if (!audio) return;
    let frame = 0;
    const tick = () => {
      const selected = range.current;
      if (!selected) return;
      if (
        audio.currentTime >= selected.end ||
        audio.currentTime < selected.start - 0.05
      ) {
        stop();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const paused = () => {
      if (audio.paused) {
        range.current = null;
        setAudition(null);
      }
    };
    audio.addEventListener("pause", paused);
    audio.addEventListener("error", stop);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("error", stop);
    };
  }, [audition, audioRef, stop]);

  const listen = async (index: number) => {
    if (index === audition) {
      stop();
      return;
    }
    const next =
      aligned && player.ready
        ? cueAudioRange(cues[index], offset, player.duration)
        : null;
    if (!next) return;
    stop();
    const request = generation.current;
    player.seek(next.start);
    range.current = next;
    setAudition(index);
    if (!(await player.play()) && generation.current === request) stop();
  };
  const seek = (value: number) => {
    if (range.current) stop();
    player.seek(value);
  };
  const visible = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) =>
      cue.text.toLocaleLowerCase("uk").includes(query.toLocaleLowerCase("uk")),
    );

  return (
    <div className="cue-preparation">
      <ol className="cue-preparation-steps" aria-label="Підготовка фрагмента">
        <li>
          <span>01</span> Прослухай
        </li>
        <li className={aligned ? "is-complete" : ""}>
          <span>{aligned ? <Check size={15} /> : "02"}</span> Прив’яжи текст
        </li>
        <li>
          <span>03</span> Обери відповідь
        </li>
      </ol>
      <div className="cue-preparation-workspace">
        <div className="cue-preparation-controls">
          <div className="cue-preparation-player">
            <div className="cue-preparation-clock">
              <span>
                <Headphones size={18} />{" "}
                {audition === null
                  ? "ПЕРЕВІРКА АУДІО"
                  : `СЛУХАЄМО РЯДОК ${audition + 1}`}
              </span>
              <time>
                {formatTime(player.position)}{" "}
                <small>/ {formatTime(player.duration)}</small>
              </time>
            </div>
            <WakeSlider
              value={player.position}
              min={0}
              max={player.duration || 1}
              step={0.01}
              onChange={seek}
              bars={72}
              height={58}
              restHeight={10}
              gap={3}
              fillColor="#d7b7ff"
              trackColor="#3d304e"
              ariaLabel="Позиція аудіо для прив’язки"
              formatValue={(v) => `${v.toFixed(2)} с`}
              disabled={!player.ready}
            />
            <div className="cue-preparation-transport">
              <Button
                className="icon-button"
                aria-label="Назад на 5 секунд у підготовці"
                disabled={!player.ready}
                onClick={() => seek(player.position - 5)}
              >
                <SkipBack size={19} />
              </Button>
              <Button
                variant="primary"
                disabled={!player.ready}
                onClick={() => {
                  const playing = player.playing;
                  stop();
                  if (!playing) void player.play();
                }}
              >
                <>
                  {player.playing ? <Pause size={18} /> : <Play size={18} />}
                  {player.playing ? "Пауза" : "Слухати"}
                </>
              </Button>
              <Button
                className="icon-button"
                aria-label="На початок аудіо у підготовці"
                disabled={!player.ready}
                onClick={() => seek(0)}
              >
                <RotateCcw size={18} />
              </Button>
              <span>
                {aligned
                  ? "Текст прив’язано"
                  : "Знайди початок знайомого рядка"}
              </span>
            </div>
            {aligned && (
              <p className="cue-preparation-current">
                <small>ЗАРАЗ У ТЕКСТІ</small>
                {current >= 0 ? cues[current].text : "Пауза між рядками"}
              </p>
            )}
          </div>
          <div className="cue-preparation-offset">
            <div>
              <strong>
                {aligned ? "Текст слідує за аудіо" : "Зістав текст із музикою"}
              </strong>
              <p>
                {aligned
                  ? "Прослухай окремий рядок і перевір збіг."
                  : "Постав на паузу на початку рядка й натисни «Прив’язати» біля нього."}
              </p>
            </div>
            <div className="cue-preparation-nudge">
              <Button
                className="icon-button"
                aria-label="Зменшити зміщення на 100 мс"
                onClick={() => onOffset(Math.max(-86400000, offset - 100))}
              >
                <Minus size={17} />
              </Button>
              <span aria-label="Зміщення тексту">
                {(offset / 1000).toFixed(1)} с
              </span>
              <Button
                className="icon-button"
                aria-label="Збільшити зміщення на 100 мс"
                onClick={() => onOffset(Math.min(86400000, offset + 100))}
              >
                <Plus size={17} />
              </Button>
            </div>
            {localAudio && (
              <Button onClick={onOriginal}>Повний запис · 0 с</Button>
            )}
          </div>
        </div>
        <div className="cue-preparation-lyrics">
          <label className="search-field compact">
            <Search size={19} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Знайти слова в пісні"
              aria-label="Пошук рядка"
            />
          </label>
          <div className="cue-preparation-list" aria-label="Рядки пісні">
            {visible.map(({ cue, index }) => {
              const playable =
                aligned &&
                player.ready &&
                !!cueAudioRange(cue, offset, player.duration);
              return (
                <div
                  key={`${cue.startMs}-${index}`}
                  className={`cue-preparation-row ${current === index ? "cue-current" : ""} ${target === index ? "cue-target" : ""} ${audition === index ? "is-auditioning" : ""}`}
                >
                  <time>{formatTime(cue.startMs / 1000)}</time>
                  <div className="cue-preparation-text">
                    <p>{cue.text}</p>
                    {cue.words?.length ? (
                      <small>
                        <AudioLines size={14} /> {timingCount(cue.words.length)}
                      </small>
                    ) : null}
                  </div>
                  <div className="cue-preparation-actions">
                    <Button
                      className="icon-button"
                      aria-label={`${audition === index ? "Зупинити" : "Прослухати"} рядок ${index + 1}`}
                      disabled={!playable}
                      title={
                        playable
                          ? "Прослухати лише цей рядок"
                          : aligned
                            ? "Рядок поза межами аудіо"
                            : "Спочатку прив’яжи текст до аудіо"
                      }
                      onClick={() => void listen(index)}
                    >
                      {audition === index ? (
                        <Pause size={18} />
                      ) : (
                        <Play size={18} />
                      )}
                    </Button>
                    <Button
                      className="icon-button"
                      aria-label={`${cue.words?.length ? "Перевірити мітки" : "Розмітити слова"} рядка ${index + 1}`}
                      title="Мітки слів"
                      onClick={() => {
                        stop();
                        onWords(index);
                      }}
                    >
                      <AudioLines size={18} />
                    </Button>
                    <Button
                      disabled={!player.ready}
                      aria-label={`Прив’язати рядок ${index + 1}`}
                      onClick={() => {
                        stop();
                        onAlign(index);
                      }}
                    >
                      Прив’язати
                    </Button>
                    <Button
                      variant={target === index ? "primary" : "soft"}
                      aria-label={`Загадати рядок ${index + 1}`}
                      onClick={() => {
                        stop();
                        onTarget(index);
                      }}
                    >
                      {target === index ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={16} />
                      )}{" "}
                      Загадати
                    </Button>
                  </div>
                </div>
              );
            })}
            {!visible.length && (
              <p className="cue-preparation-empty">
                Такого рядка не знайшли. Спробуй кілька інших слів.
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="cue-preparation-help">
        «Загадати» обирає рядок, який команда має продовжити. Відповідь
        прихована на сцені до результату. Прослуховування в цьому вікні не
        починає раунд.
      </p>
      <div className="cue-preparation-files">
        <Button
          variant="ghost"
          onClick={() => {
            stop();
            onImport();
          }}
        >
          <Upload size={17} /> Свій LRC
        </Button>
        <Button variant="ghost" disabled={!cues.length} onClick={onExport}>
          <ArrowDownToLine size={17} /> Зберегти LRC
        </Button>
        {imported && (
          <Button
            variant="ghost"
            onClick={() => {
              stop();
              onProvider();
            }}
          >
            Текст Deezer
          </Button>
        )}
      </div>
    </div>
  );
}
