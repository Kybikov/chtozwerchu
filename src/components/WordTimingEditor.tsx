import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Headphones,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Undo2,
  Waves,
} from "lucide-react";
import { Button, Modal } from "./ui";
import WakeSlider from "./react-bits/WakeSlider";
import type { Cue, WordCue } from "../lib/music";
import type { usePlayer } from "../lib/usePlayer";
import {
  lyricTokens,
  preciseTime,
  recordedWords,
  shiftWordStart,
  validWordTiming,
  timingCount,
} from "../lib/wordTiming";
import "../word-timing.css";

type Props = {
  cue: Cue;
  line: number;
  offset: number;
  aligned: boolean;
  player: ReturnType<typeof usePlayer>;
  onSave: (words: WordCue[] | undefined) => Promise<boolean>;
  onClose: () => void;
  providerWords?: boolean;
};

export default function WordTimingEditor({
  cue,
  line,
  offset,
  aligned,
  player,
  onSave,
  onClose,
  providerWords = false,
}: Props) {
  const [draft, setDraft] = useState<WordCue[] | undefined>(() =>
    cue.words?.map((w) => ({ ...w })),
  );
  const [starts, setStarts] = useState<number[]>([]);
  const [recording, setRecording] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [partial, setPartial] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const tokens = lyricTokens(cue.text);
  const available =
    player.ready &&
    aligned &&
    tokens.length > 0 &&
    tokens.length <= 300 &&
    cue.startMs - offset >= 0 &&
    cue.endMs - offset <= player.duration * 1000 + 20;
  const now = Math.round(player.position * 1000 + offset);
  const valid = validWordTiming(cue, draft);
  const sampled = useRef<number[]>([]);
  const pending = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const latest = useRef({ player, recording, stamp: () => {} });

  const stop = () => {
    generation.current++;
    player.pause();
    setRecording(false);
    setPreviewing(false);
  };
  const requestClose = () => {
    stop();
    if (dirty) setDiscard(true);
    else onClose();
  };
  const begin = async (capture: boolean) => {
    if (!available || pending.current) return;
    pending.current = true;
    stop();
    const version = generation.current;
    setMessage("");
    if (capture) {
      sampled.current = [];
      setStarts([]);
      setPartial(true);
      setDirty(true);
    }
    player.seek(
      Math.max(0, (cue.startMs - offset) / 1000 - (capture ? 1 : 0.25)),
    );
    const ok = await player.play();
    if (!alive.current || version !== generation.current) {
      player.pause();
      pending.current = false;
      return;
    }
    if (ok) {
      setRecording(capture);
      setPreviewing(!capture);
    } else setMessage("Дозволь відтворення й спробуй ще раз.");
    pending.current = false;
  };
  const stamp = () => {
    const audio = player.ref.current;
    if (
      !recording ||
      !audio ||
      audio.paused ||
      audio.seeking ||
      audio.readyState < 2
    )
      return;
    const at = Math.round(audio.currentTime * 1000 + offset);
    const captured = sampled.current;
    if (at < cue.startMs) {
      setMessage("Ще мить — дочекайся початку рядка.");
      return;
    }
    if (
      at > cue.endMs ||
      (captured.length && at <= captured[captured.length - 1])
    ) {
      setMessage("Мітки мають іти вперед і залишатися в межах рядка.");
      return;
    }
    if (captured.length < tokens.length) {
      sampled.current = [...captured, at];
      setStarts(sampled.current);
      setMessage("");
    } else {
      const words = recordedWords(cue, captured, at);
      if (!words) {
        setMessage("Перевір послідовність міток і спробуй знову.");
        return;
      }
      setDraft(words);
      setPartial(false);
      setSelected(0);
      stop();
      setMessage("Мітки готові. Прослухай рядок і перевір підсвічування.");
    }
  };
  latest.current = { player, recording, stamp };
  useEffect(() => {
    alive.current = true;
    const key = (e: KeyboardEvent) => {
      if (
        !latest.current.recording ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.code !== "Space"
      )
        return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches('input,textarea,[role="slider"]') ||
          e.target.isContentEditable)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.stamp();
    };
    window.addEventListener("keydown", key, true);
    return () => {
      alive.current = false;
      generation.current++;
      window.removeEventListener("keydown", key, true);
      latest.current.player.pause();
    };
  }, []);
  useEffect(() => {
    if ((previewing || recording) && now >= cue.endMs) {
      stop();
      if (recording)
        setMessage(
          "Рядок закінчився. Запиши всі слова та натисни «Кінець рядка» до завершення.",
        );
    }
  }, [now, previewing, recording, cue.endMs]);
  const nudge = (delta: number) => {
    if (!valid || !draft) return;
    const next = shiftWordStart(cue, draft, selected, delta);
    if (!next) {
      setMessage("Далі — сусіднє слово або межа рядка.");
      return;
    }
    setDraft(next);
    setDirty(true);
    setMessage("");
  };
  const save = async () => {
    if (saving || recording || partial || (draft && !valid)) return;
    stop();
    setSaving(true);
    setMessage("");
    try {
      if (!(await onSave(draft)))
        setMessage(
          "Браузер не зміг зберегти мітки. Звільни місце й повтори спробу.",
        );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && !saving && requestClose()}
      title={discard ? "Залишити незбережені мітки?" : "Кожне слово — в такт"}
      description={
        discard
          ? "Збережені раніше мітки залишаться. Поточні зміни буде втрачено."
          : providerWords && !dirty
            ? `Рядок ${line + 1}. Послівні мітки вже готові. Перевір прив’язку до аудіо й прослухай підсвічування.`
            : `Рядок ${line + 1}. Натискай пробіл або кнопку на початку кожного слова, а потім познач кінець рядка.`
      }
      wide
    >
      {discard ? (
        <div className="word-editor-discard">
          <Button onClick={() => setDiscard(false)}>
            <ArrowLeft size={18} /> Повернутися до міток
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Відкинути зміни
          </Button>
        </div>
      ) : (
        <div className="word-editor">
          <div className="word-editor-heading">
            <span>
              <Waves size={17} /> МУЗИКА Й СЛОВА
            </span>
            <span className="word-editor-status">
              {recording
                ? `${starts.length} / ${tokens.length}`
                : valid
                  ? timingCount(draft.length)
                  : "Мітки рядка"}
            </span>
          </div>
          {providerWords && !dirty && (
            <div className="word-editor-source">
              <BadgeCheck size={24} />
              <div>
                <strong>Послівні мітки Deezer</strong>
                <p>
                  Мітки для цього рядка вже отримано. Прослухай рядок і перевір
                  прив’язку до свого аудіо; за потреби відкоригуй мітки.
                </p>
              </div>
            </div>
          )}
          <div
            className={`word-editor-lyric ${recording ? "is-recording" : ""}`}
            aria-label="Попередній перегляд слів"
          >
            {recording || partial
              ? tokens.map((text, i) => (
                  <span
                    key={i}
                    className={
                      i < starts.length
                        ? "is-marked"
                        : i === starts.length
                          ? "is-next"
                          : ""
                    }
                  >
                    {text}{" "}
                  </span>
                ))
              : valid
                ? draft.map((word, i) => (
                    <span
                      key={i}
                      className={
                        now >= word.startMs
                          ? now < word.endMs
                            ? "is-active"
                            : "is-marked"
                          : ""
                      }
                    >
                      {word.text}
                    </span>
                  ))
                : cue.text}
          </div>
          {!available && (
            <p className="word-editor-notice">
              {!aligned
                ? "Спочатку повернися до рядків і прив’яжи текст до аудіо."
                : "Цей рядок не вміщується у фрагмент. Додай повний аудіозапис або перевір прив’язку."}
            </p>
          )}
          <div className="word-editor-clock">
            <time>
              {preciseTime(Math.max(cue.startMs, Math.min(cue.endMs, now)))}
            </time>
            <span>
              {preciseTime(cue.startMs)} — {preciseTime(cue.endMs)}
            </span>
          </div>
          <WakeSlider
            value={Math.max(cue.startMs, Math.min(cue.endMs, now))}
            min={cue.startMs}
            max={cue.endMs}
            step={10}
            onChange={(value) => player.seek((value - offset) / 1000)}
            disabled={!available || recording || saving}
            bars={55}
            height={35}
            restHeight={8}
            fillColor="#aba8f5"
            trackColor="#393047"
            ariaLabel="Позиція в рядку"
          />
          {recording ? (
            <div className="word-editor-record">
              <Button
                variant="primary"
                className="word-stamp"
                onClick={stamp}
                disabled={!player.playing || now < cue.startMs}
                aria-label={
                  starts.length < tokens.length
                    ? `Позначити слово ${tokens[starts.length]}`
                    : "Позначити кінець рядка"
                }
              >
                <span>
                  {starts.length < tokens.length
                    ? now < cue.startMs
                      ? "ПРИГОТУЙСЯ — ЗАРАЗ ПОЧНЕТЬСЯ"
                      : "ЗАРАЗ ЗВУЧИТЬ"
                    : "СЛОВА ЗАПИСАНО"}
                </span>
                <strong>{tokens[starts.length] ?? "Кінець рядка"}</strong>
                <small>
                  <kbd>Пробіл</kbd> або натисни тут
                </small>
              </Button>
              <div className="word-editor-actions">
                <Button
                  variant="ghost"
                  disabled={!starts.length}
                  onClick={() => {
                    sampled.current = sampled.current.slice(0, -1);
                    setStarts(sampled.current);
                  }}
                >
                  <Undo2 size={17} /> Останню назад
                </Button>
                <Button variant="ghost" onClick={stop}>
                  <Pause size={17} /> Зупинити запис
                </Button>
                {!player.playing && (
                  <Button onClick={() => void player.play()}>
                    <Play size={17} /> Продовжити звук
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="word-editor-actions">
              <Button
                variant="primary"
                disabled={!available || saving}
                onClick={() => void begin(true)}
              >
                <Waves size={18} />{" "}
                {partial
                  ? "Записати заново"
                  : valid
                    ? "Перезаписати мітки"
                    : "Розмітити слова"}
              </Button>
              <Button
                disabled={!available || saving}
                onClick={() => (previewing ? stop() : void begin(false))}
              >
                {previewing ? <Pause size={18} /> : <Headphones size={18} />}{" "}
                {previewing ? "Пауза перевірки" : "Прослухати рядок"}
              </Button>
            </div>
          )}
          {valid && !recording && !partial && (
            <div className="word-editor-fine">
              <div className="word-editor-label">
                ТОЧНІШЕ В РИТМ <span>Обери слово для корекції</span>
              </div>
              <div className="word-editor-chips">
                {draft.map((word, i) => (
                  <Button
                    key={i}
                    variant={selected === i ? "primary" : "soft"}
                    aria-pressed={selected === i}
                    onClick={() => setSelected(i)}
                  >
                    <span>{word.text.trim()}</span>
                    <time>{preciseTime(word.startMs)}</time>
                  </Button>
                ))}
              </div>
              <div className="word-editor-nudge">
                <Button
                  aria-label="Слово на 50 мс раніше"
                  onClick={() => nudge(-50)}
                >
                  <Minus size={17} /> 50 мс
                </Button>
                <span>
                  Початок:{" "}
                  <b>
                    {draft[selected]
                      ? preciseTime(draft[selected].startMs)
                      : "—"}
                  </b>
                </span>
                <Button
                  aria-label="Слово на 50 мс пізніше"
                  onClick={() => nudge(50)}
                >
                  <Plus size={17} /> 50 мс
                </Button>
              </div>
            </div>
          )}
          {message && (
            <p className="word-editor-message" role="status">
              {message}
            </p>
          )}
          <div className="word-editor-footer">
            <Button variant="ghost" onClick={requestClose} disabled={saving}>
              <ArrowLeft size={17} /> До рядків
            </Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={
                !dirty || recording || partial || saving || (!!draft && !valid)
              }
            >
              <Save size={17} /> {saving ? "Зберігаємо…" : "Зберегти мітки"}
            </Button>
          </div>
          {(draft?.length || partial) && !recording && (
            <Button
              variant="ghost"
              className="word-editor-clear"
              disabled={saving}
              onClick={() => {
                setDraft(undefined);
                setPartial(false);
                setStarts([]);
                setDirty(true);
                setMessage(
                  "Залишаться тільки мітки рядка. Збережи, щоб підтвердити.",
                );
              }}
            >
              <RotateCcw size={15} /> Залишити тільки рядок
            </Button>
          )}
          <p className="word-editor-footnote">
            <Check size={14} /> Підсвічування йде за аудіо та часовими мітками.
            Проміжки між словами залишаються тишею.
          </p>
        </div>
      )}
    </Modal>
  );
}
