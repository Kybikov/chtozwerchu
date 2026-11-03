import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  Disc3,
  FileText,
  History,
  LoaderCircle,
  ListMusic,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Smartphone,
  Trophy,
  Volume2,
  Zap,
} from "lucide-react";
import { Button, ButtonLink, Modal, Panel } from "./ui";
import AlbumCover from "./AlbumCover";
import { usePWAActivity } from "../lib/pwa";
import { PWAUpdateControl } from "./PWAUpdate";
import Backdrop from "./Backdrop";
import WakeSlider from "./react-bits/WakeSlider";
import SquishSwitch from "./react-bits/SquishSwitch";
import { Scoreboard } from "./ShowStage";
import {
  linkConnection,
  roomRemaining,
  roomScene,
  roomURL,
  useStudioConnection,
} from "../lib/studioRoom";
import { api, curated, formatTime, type Track, type Team } from "../lib/music";
import { matchWinner } from "../lib/match";
import PreparedSongs from "./PreparedSongs";
import ProgrammeOrder from "./ProgrammeOrder";
import LyricTimingStatus from "./LyricTimingStatus";
import ClipLengthControl from "./ClipLengthControl";
import "../programme.css";

export default function RemotePanel() {
  const [connection] = useState(() => linkConnection("host"));
  const room = useStudioConnection(connection),
    s = room.state;
  const [sheet, setSheet] = useState<
    | "cues"
    | "library"
    | "settings"
    | "history"
    | "new_game"
    | "programme"
    | null
  >(null);
  const [query, setQuery] = useState(""),
    [tracks, setTracks] = useState<Track[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState("");
  const [names, setNames] = useState({ girls: "Дівчата", boys: "Хлопці" }),
    [rounds, setRounds] = useState(8),
    [seconds, setSeconds] = useState(20),
    [effects, setEffects] = useState(true);
  const [cueQuery, setCueQuery] = useState(""),
    [copied, setCopied] = useState(false),
    [volume, setVolume] = useState(65);
  const interactionUntil = useRef(0);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (s && !room.pending) setVolume(s.audio.volume);
  }, [s?.audio.volume, room.pending]);
  useEffect(
    () => () => {
      if (volumeTimer.current) clearTimeout(volumeTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!query.trim()) {
      setTracks([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(
      () =>
        api<{ tracks: Track[] }>(
          `/api/music/search?q=${encodeURIComponent(query)}`,
          ctrl.signal,
        )
          .then((r) => setTracks(r.tracks))
          .catch((e) => {
            if (!ctrl.signal.aborted) setSearchError(e.message);
          })
          .finally(() => {
            if (!ctrl.signal.aborted) setSearching(false);
          }),
      350,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);
  const scene = s ? roomScene(s, room.serverNow, room.connected) : null;
  const locked = !room.connected || room.pending || room.terminal;
  usePWAActivity(
    (!s && !room.terminal) ||
      s?.phase === "playing" ||
      s?.phase === "answer" ||
      !!s?.audio.playing ||
      room.pending ||
      sheet === "settings",
    true,
  );
  const remaining = s ? roomRemaining(s, room.serverNow) : 0;
  const target = s?.track.cues[s.session.target];
  const showSettings = () => {
    if (!s) return;
    setNames(s.session.names);
    setRounds(s.session.rounds);
    setSeconds(s.session.answerSeconds);
    setEffects(s.effects);
    setSheet("settings");
  };
  const selectTrack = (id: number) => {
    if (room.action({ type: "load_track", trackId: id })) setSheet(null);
  };
  const award = (team: Team | null) => {
    interactionUntil.current = performance.now() + 1200;
    return room.action({ type: "award", team });
  };
  const winner = s ? matchWinner(s.session.scores) : null;
  return (
    <div
      className={`app-shell remote-shell remote-phase-${s?.phase ?? "ready"} team-${s?.session.team ?? "girls"}`}
    >
      <Backdrop effects={s?.effects ?? true} />
      <header className="remote-header">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Zap size={23} fill="currentColor" />
          </span>
          <span>
            хто
            <span className="brand-bottom">
              зверху<span className="brand-dot">?</span>
            </span>
          </span>
        </a>
        <div className="remote-room">
          <span className={room.connected ? "connected-dot" : "waiting-dot"} />
          <span>
            КІМНАТА <b>{connection.code || "—"}</b>
          </span>
        </div>
        <div className="remote-header-actions">
          <PWAUpdateControl />
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Налаштування гри"
            onClick={showSettings}
            disabled={!s}
          >
            <Settings2 size={20} />
          </Button>
        </div>
      </header>
      <main className="remote-main">
        <div className="remote-intro">
          <p className="eyebrow">
            <Smartphone size={15} />
            ПУЛЬТ ВЕДУЧОГО
          </p>
          <h1>
            ТИ КЕРУЄШ <span>ШОУ.</span>
          </h1>
          <p>Уся увага — командам. Усе керування — тут.</p>
        </div>
        {(!room.connected || room.error) && (
          <div role="status" className="network-notice">
            <strong>
              {room.terminal
                ? "Підключення завершено"
                : !room.connected
                  ? "Відновлюємо зв’язок"
                  : "Дію не виконано"}
            </strong>
            <p>{room.error || "Підключаємося до сцени…"}</p>
            {room.terminal && (
              <ButtonLink variant="soft" href="/">
                Повернутися до гри
              </ButtonLink>
            )}
          </div>
        )}
        {!s ? (
          <Panel className="remote-wait">
            <LoaderCircle className="spin" size={32} />
            <h2>Шукаємо сцену.</h2>
            <p>Відкрий приватне посилання з екрана гри.</p>
          </Panel>
        ) : (
          <>
            {scene && <Scoreboard state={scene} />}
            {s.session.programme && (
              <section
                className="programme-summary"
                aria-label="Програма вечора"
              >
                <ListMusic size={24} />
                <div>
                  <strong>{s.session.programme.title}</strong>
                  <p>
                    {s.session.finished
                      ? `Програму завершено · ${s.session.rounds} раундів зіграно.`
                      : `Пісня ${s.session.round} з ${s.session.rounds} · Наступний запис завантажиться після оцінки раунду.`}
                  </p>
                </div>
                <Button onClick={() => setSheet("programme")}>
                  Порядок вечора
                </Button>
                <Button
                  variant="ghost"
                  disabled={locked || !["ready", "result"].includes(s.phase)}
                  onClick={() => room.action({ type: "manual_programme" })}
                >
                  Обирати пісні вручну
                </Button>
              </section>
            )}
            {!room.presence.station && (
              <div className="notice">
                <Monitor size={20} />
                <span>
                  Екран гри від’єднано. Поверни його в мережу, щоб продовжити
                  музику.
                </span>
              </div>
            )}
            {s.notice && (
              <div className="notice">
                <AudioLines size={18} />
                <span>{s.notice}</span>
              </div>
            )}
            <Panel
              className={`remote-game phase-${s.phase}`}
              onClickCapture={(e) => {
                if (
                  e.detail > 1 ||
                  performance.now() < interactionUntil.current
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              <div className="remote-phase">
                <span>
                  РАУНД {String(s.session.round).padStart(2, "0")} /{" "}
                  {s.session.rounds}
                </span>
                <b>
                  {s.phase === "ready"
                    ? "ПІДГОТОВКА"
                    : s.phase === "playing"
                      ? "МУЗИЧНИЙ ФРАГМЕНТ"
                      : s.phase === "answer"
                        ? "ВІДПОВІДЬ"
                        : s.phase === "result"
                          ? "РЕЗУЛЬТАТ"
                          : "ФІНАЛ"}
                </b>
              </div>
              {s.phase === "ready" && (
                <>
                  <div className="remote-track">
                    <div className="track-art">
                      {s.track.cover ? (
                        <AlbumCover src={s.track.cover} />
                      ) : (
                        <Disc3 size={30} />
                      )}
                    </div>
                    <div>
                      <h2>{s.track.title}</h2>
                      <p>{s.track.artist}</p>
                      <small>
                        {s.audio.local
                          ? "ВЛАСНИЙ ЗАПИС НА СЦЕНІ"
                          : "DEEZER · ПРЕВ’Ю"}
                      </small>
                    </div>
                    <Button
                      variant="ghost"
                      className="icon-button"
                      aria-label="Змінити пісню"
                      disabled={locked}
                      onClick={() => setSheet("library")}
                    >
                      <ChevronRight size={22} />
                    </Button>
                  </div>
                  <LyricTimingStatus
                    cues={s.track.cues}
                    imported={s.track.lyricsStatus === "imported"}
                  />
                  <div className="remote-sync">
                    <span
                      className={
                        s.session.aligned ? "connected-dot" : "waiting-dot"
                      }
                    />
                    {s.session.aligned
                      ? "Текст прив’язано до музики"
                      : "Потрібна прив’язка рядка"}
                    <Button
                      variant="ghost"
                      disabled={locked}
                      onClick={() => setSheet("cues")}
                    >
                      Налаштувати
                      <ArrowRight size={15} />
                    </Button>
                  </div>
                  <div className="remote-answer-card">
                    <small>ЦЕ ПРОДОВЖУВАТИМЕ КОМАНДА</small>
                    <p>«{target?.text || "Обери рядок у тексті"}»</p>
                    <Button
                      variant="ghost"
                      onClick={() => setSheet("cues")}
                      disabled={locked}
                    >
                      Обрати інший рядок
                      <ChevronRight size={15} />
                    </Button>
                  </div>
                  <div className="host-clip">
                    <ClipLengthControl
                      value={s.session.leadInSeconds}
                      disabled={locked}
                      onChange={(seconds) =>
                        room.action({ type: "clip", index: seconds })
                      }
                    />
                  </div>
                  <Button
                    variant="primary"
                    className="full-width remote-launch"
                    disabled={
                      locked ||
                      !s.session.aligned ||
                      !s.audio.ready ||
                      !room.presence.station
                    }
                    onClick={() => room.action({ type: "start" })}
                  >
                    <Play size={20} fill="currentColor" />
                    Почати раунд
                    <ArrowRight size={20} />
                  </Button>
                  {!s.audio.ready && !s.needsTrack && (
                    <p className="remote-hint">
                      Спочатку натисни «Увімкнути звук» на екрані гри.
                    </p>
                  )}
                </>
              )}
              {s.phase === "playing" && (
                <>
                  <p className="stage-kicker">
                    {s.audio.playing ? "СЛУХАЄМО ФРАГМЕНТ" : "МУЗИКА НА ПАУЗІ"}
                  </p>
                  <h2 className="remote-state-title">
                    {s.audio.playing ? "ЛОВИМО РИТМ." : "ТРИМАЄМО ПАУЗУ."}
                  </h2>
                  <p className="remote-current-line">
                    {scene?.lyric || "Продовження ще приховане від команди."}
                  </p>
                  <div className="remote-answer-card">
                    <small>ВІДПОВІДЬ ДЛЯ ВЕДУЧОГО</small>
                    <p>«{target?.text}»</p>
                  </div>
                  <div className="action-pair">
                    <Button
                      disabled={locked || !s.audio.ready}
                      onClick={() => room.action({ type: "music_toggle" })}
                    >
                      {s.audio.playing ? (
                        <Pause size={18} />
                      ) : (
                        <Play size={18} />
                      )}{" "}
                      {s.audio.playing ? "Пауза" : "Продовжити"}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={locked}
                      onClick={() => room.action({ type: "answer" })}
                    >
                      Час відповіді
                      <ArrowRight size={18} />
                    </Button>
                  </div>
                </>
              )}
              {s.phase === "answer" && (
                <>
                  <div className="remote-clock">
                    <strong>{String(remaining).padStart(2, "0")}</strong>
                    <span>
                      {!room.connected
                        ? "ЧЕКАЄМО ЗВ’ЯЗКУ"
                        : remaining === 0
                          ? "ЧАС ВИЙШОВ"
                          : s.timer.paused
                            ? "ВІДЛІК НА ПАУЗІ"
                            : "СЕКУНД НА ВІДПОВІДЬ"}
                    </span>
                  </div>
                  <Button
                    className="full-width"
                    disabled={locked || remaining === 0}
                    onClick={() => room.action({ type: "timer_toggle" })}
                  >
                    {s.timer.paused ? <Play size={18} /> : <Pause size={18} />}{" "}
                    {s.timer.paused
                      ? "Продовжити відлік"
                      : "Призупинити відлік"}
                  </Button>
                  <div className="remote-answer-card">
                    <small>ПРАВИЛЬНЕ ПРОДОВЖЕННЯ</small>
                    <p>«{target?.text}»</p>
                  </div>
                  <h2 className="remote-question">Хто забирає 3 бали?</h2>
                  <div className="action-pair remote-awards">
                    <Button
                      className="award-girls"
                      disabled={locked}
                      onClick={() => award("girls")}
                    >
                      <Check size={18} />
                      {s.session.names.girls}
                    </Button>
                    <Button
                      className="award-boys"
                      disabled={locked}
                      onClick={() => award("boys")}
                    >
                      <Check size={18} />
                      {s.session.names.boys}
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    className="full-width"
                    disabled={locked}
                    onClick={() => award(null)}
                  >
                    Цього разу ніхто
                  </Button>
                </>
              )}
              {s.phase === "result" && (
                <>
                  <Trophy className="remote-trophy" size={44} />
                  <p className="stage-kicker">
                    {s.awarded ? "ЦЕ БУЛО КРАСИВО" : "НАСТУПНИЙ ХІТ БУДЕ ВАШ"}
                  </p>
                  <h2 className="remote-state-title gradient-type">
                    {s.awarded ? "+3 БАЛИ" : "БЕЗ БАЛІВ"}
                  </h2>
                  <p className="remote-winner">
                    {s.awarded
                      ? s.session.names[s.awarded]
                      : "Музика ще дасть шанс."}
                  </p>
                  <div className="remote-answer-card">
                    <small>ПРОДОВЖЕННЯ ПІСНІ</small>
                    <p>
                      «
                      {
                        s.session.history.find(
                          (r) => r.round === s.session.round,
                        )?.line
                      }
                      »
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    className="full-width remote-launch"
                    disabled={locked}
                    onClick={() => room.action({ type: "next" })}
                  >
                    {s.session.round >= s.session.rounds
                      ? "Показати фінал"
                      : "Наступний раунд"}
                    <ArrowRight size={20} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="full-width"
                    disabled={locked}
                    onClick={() => room.action({ type: "undo" })}
                  >
                    <RotateCcw size={16} />
                    Виправити оцінку
                  </Button>
                </>
              )}
              {s.phase === "final" && (
                <>
                  <div className="final-stars">✦</div>
                  <p className="stage-kicker">ЦЕ БУЛО ШОУ</p>
                  <h2 className="remote-state-title gradient-type">
                    {winner ? "ПЕРЕМОГА!" : "НІЧИЯ!"}
                  </h2>
                  <p className="remote-winner">
                    {winner ? s.session.names[winner] : "Сьогодні зверху всі."}
                  </p>
                  <p className="remote-final-score">
                    {s.session.scores.girls}
                    <span>:</span>
                    {s.session.scores.boys}
                  </p>
                  <Button
                    variant="primary"
                    className="full-width remote-launch"
                    disabled={locked}
                    onClick={() => setSheet("new_game")}
                  >
                    Граємо ще
                    <ArrowRight size={20} />
                  </Button>
                </>
              )}
            </Panel>
            <Panel className="remote-sound">
              <div className="section-label">
                <span>
                  <Volume2 size={16} />
                  ЗВУК НА СЦЕНІ
                </span>
                <span>
                  {formatTime(s.audio.position)} /{" "}
                  {formatTime(s.audio.duration)}
                </span>
              </div>
              {(s.phase === "ready" || s.phase === "result") && (
                <Button
                  className="full-width"
                  disabled={locked || !s.audio.ready}
                  onClick={() => room.action({ type: "music_toggle" })}
                >
                  {s.audio.playing ? <Pause size={18} /> : <Play size={18} />}{" "}
                  {s.audio.playing
                    ? "Пауза прослуховування"
                    : "Прослухати на сцені"}
                </Button>
              )}
              <div className="remote-volume">
                <Volume2 size={20} />
                <WakeSlider
                  value={volume}
                  onChange={(value) => {
                    setVolume(value);
                    if (volumeTimer.current) clearTimeout(volumeTimer.current);
                    volumeTimer.current = setTimeout(
                      () =>
                        room.action({
                          type: "volume",
                          index: Math.round(value),
                        }),
                      250,
                    );
                  }}
                  disabled={locked || !s.audio.ready}
                  bars={28}
                  height={36}
                  restHeight={10}
                  fillColor="#c7a5f5"
                  trackColor="#493255"
                  ariaLabel="Гучність на сцені"
                />
                <span>{volume}%</span>
              </div>
            </Panel>
            <div className="remote-bottom-actions">
              <Button disabled={locked} onClick={() => setSheet("history")}>
                <History size={18} />
                Історія раундів
              </Button>
              <ButtonLink
                variant="ghost"
                href={roomURL(connection.code, "audience")}
                target="_blank"
                rel="noopener"
              >
                <Monitor size={18} />
                Екран глядача
              </ButtonLink>
            </div>
          </>
        )}
      </main>
      <Modal
        open={sheet === "cues"}
        onOpenChange={(v) => !v && setSheet(null)}
        title="Музика й слова — разом."
        description="Увімкни прослуховування на сцені. Натисни «Зараз звучить» на початку рядка, який чуєш."
        wide
      >
        {s && (
          <>
            <div className="cue-transport">
              <Button
                disabled={locked || !s.audio.ready}
                onClick={() => room.action({ type: "music_toggle" })}
              >
                {s.audio.playing ? <Pause size={18} /> : <Play size={18} />}{" "}
                {s.audio.playing ? "Пауза" : "Слухати"}
              </Button>
              <span className="mono">
                {formatTime(s.audio.position)} / {formatTime(s.audio.duration)}
              </span>
              {s.audio.local && (
                <Button
                  disabled={locked}
                  onClick={() => room.action({ type: "original_timeline" })}
                >
                  Повний запис · 0 с
                </Button>
              )}
            </div>
            <WakeSlider
              value={s.audio.position}
              min={0}
              max={Math.max(1, s.audio.duration)}
              step={0.1}
              onChange={(position) => {
                if (!room.pending) room.action({ type: "seek", position });
              }}
              disabled={locked || !s.audio.ready}
              height={32}
              bars={50}
              restHeight={10}
              ariaLabel="Позиція музики на сцені"
              fillColor="#c7a5f5"
              trackColor="#493255"
            />
            <label className="search-field compact">
              <Search size={18} />
              <input
                value={cueQuery}
                onChange={(e) => setCueQuery(e.target.value)}
                placeholder="Знайти слова"
                aria-label="Пошук рядка"
              />
            </label>
            <div className="cue-list">
              {s.track.cues
                .map((cue, index) => ({ cue, index }))
                .filter(({ cue }) =>
                  cue.text
                    .toLocaleLowerCase("uk")
                    .includes(cueQuery.toLocaleLowerCase("uk")),
                )
                .map(({ cue, index }) => (
                  <div
                    key={index}
                    className={`cue-row ${index === s.session.target ? "cue-target" : ""}`}
                  >
                    <time>{formatTime(cue.startMs / 1000)}</time>
                    <span>{cue.text}</span>
                    <Button
                      disabled={locked}
                      onClick={() => room.action({ type: "align", index })}
                    >
                      Зараз звучить
                    </Button>
                    <Button
                      disabled={locked}
                      variant={index === s.session.target ? "primary" : "soft"}
                      aria-label={`Загадати рядок ${index + 1}`}
                      onClick={() => {
                        if (room.action({ type: "target", index }))
                          setSheet(null);
                      }}
                    >
                      <Check size={16} />
                      <span className="cue-action-label">Загадати</span>
                    </Button>
                  </div>
                ))}
            </div>
            <p className="modal-footnote">
              Прив’язка використовує позицію аудіо на екрані гри. Прихований
              рядок побачиш тільки ти до оцінки відповіді.
            </p>
          </>
        )}
      </Modal>
      <Modal
        open={sheet === "programme"}
        onOpenChange={(v) => !v && setSheet(null)}
        title={s?.session.programme?.title ?? "Програма вечора"}
        description="Пісні у заздалегідь підготовленому порядку. Керуй грою з цього пульта."
        wide
      >
        {s?.session.programme && (
          <ProgrammeOrder
            programme={s.session.programme}
            songs={s.library ?? []}
            round={s.session.finished ? s.session.round + 1 : s.session.round}
          />
        )}
      </Modal>
      <Modal
        open={sheet === "library"}
        onOpenChange={(v) => !v && setSheet(null)}
        title="Що сьогодні співаємо?"
        description="Пісня завантажиться на екрані гри. Для нового прев’ю перевір прив’язку рядка."
        wide
      >
        <label className="search-field">
          <Search size={20} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Пошук пісні"
            placeholder="Пісня або виконавець"
          />
        </label>
        <div className="library-caption">
          <span>{query ? "РЕЗУЛЬТАТИ ПОШУКУ" : "ЗНАЙОМІ ХІТИ"}</span>
          {searching && <LoaderCircle size={18} className="spin" />}
        </div>
        {searchError && <p className="inline-error">{searchError}</p>}
        <PreparedSongs
          songs={s?.library ?? []}
          busy={locked || !room.presence.station || s?.phase !== "ready"}
          onLoad={(id) => {
            if (room.action({ type: "load_prepared", trackId: id }))
              setSheet(null);
          }}
        />
        <div className="track-library">
          {query
            ? tracks.map((t) => (
                <Button
                  key={t.id}
                  className="library-result"
                  disabled={locked}
                  onClick={() => selectTrack(t.id)}
                >
                  <AlbumCover src={t.cover} />
                  <span>
                    <strong>{t.title}</strong>
                    <small>{t.artist}</small>
                  </span>
                  <ChevronRight size={20} />
                </Button>
              ))
            : curated.map((t, i) => (
                <Panel key={t.id} className="curated-card">
                  <div className={`curated-art art-${i}`}>
                    <Disc3 size={72} />
                    <span>0{i + 1}</span>
                  </div>
                  <span className="curated-mood">{t.mood}</span>
                  <h3>{t.title}</h3>
                  <p>{t.artist}</p>
                  <Button disabled={locked} onClick={() => selectTrack(t.id)}>
                    Обрати пісню
                    <ArrowRight size={16} />
                  </Button>
                </Panel>
              ))}
        </div>
      </Modal>
      <Modal
        open={sheet === "settings"}
        onOpenChange={(v) => !v && setSheet(null)}
        title="Твоя гра — твій темп."
        description="Налаштування застосовуються перед початком раунду."
      >
        {s && (
          <>
            <div className="settings-teams">
              {(["girls", "boys"] as Team[]).map((team) => (
                <label key={team} className={team}>
                  <span>
                    {team === "girls" ? "Рожева команда" : "Синя команда"}
                  </span>
                  <input
                    value={names[team]}
                    maxLength={32}
                    onChange={(e) =>
                      setNames((n) => ({ ...n, [team]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="setting-row">
              <span>
                <strong>Кількість раундів</strong>
                <small>Порівну ходів для двох команд</small>
              </span>
              <div className="option-grid">
                {[4, 8, 12, 16].map((n) => (
                  <Button
                    key={n}
                    className={rounds === n ? "selected" : ""}
                    disabled={n < s.session.round || !!s.session.programme}
                    onClick={() => setRounds(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>
                <strong>Час на відповідь</strong>
                <small>Ведучий може призупинити відлік</small>
              </span>
              <div className="option-grid">
                {[15, 20, 30, 45].map((n) => (
                  <Button
                    key={n}
                    className={seconds === n ? "selected" : ""}
                    onClick={() => setSeconds(n)}
                  >
                    {n} с
                  </Button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>
                <strong>Атмосферні ефекти</strong>
                <small>Живе світло на екрані шоу</small>
              </span>
              <SquishSwitch
                checked={effects}
                onChange={setEffects}
                width={48}
                height={28}
                ariaLabel="Атмосферні ефекти на сцені"
                trackOnColor="#aa89df"
              />
            </div>
            <Button
              variant="primary"
              className="full-width"
              disabled={
                locked ||
                s.phase !== "ready" ||
                !names.girls.trim() ||
                !names.boys.trim()
              }
              onClick={() => {
                if (
                  room.action({
                    type: "config",
                    config: { names, rounds, answerSeconds: seconds, effects },
                  })
                )
                  setSheet(null);
              }}
            >
              Зберегти налаштування
              <Check size={18} />
            </Button>
            {s.phase !== "ready" && (
              <p className="modal-footnote">
                Зміни можна зберегти під час підготовки наступного раунду.
              </p>
            )}
            <Button
              className="full-width"
              onClick={() =>
                void navigator.clipboard
                  .writeText(roomURL(connection.code, "audience"))
                  .then(() => setCopied(true))
              }
            >
              <Copy size={17} />
              {copied
                ? "Посилання сцени скопійовано"
                : "Скопіювати посилання глядача"}
            </Button>
          </>
        )}
      </Modal>
      <Modal
        open={sheet === "history"}
        onOpenChange={(v) => !v && setSheet(null)}
        title="Кожен хіт — у рахунок."
        description={`${s?.session.history.length ?? 0} ${[2, 3, 4].includes(s?.session.history.length ?? 0) ? "раунди" : s?.session.history.length === 1 ? "раунд" : "раундів"} зіграно. Результати зберігає сервер.`}
        wide
      >
        {s?.session.history.length ? (
          <ol className="round-history">
            {s.session.history.map((r) => (
              <li key={r.round}>
                <span className="history-number">
                  {String(r.round).padStart(2, "0")}
                </span>
                <div>
                  <strong>{r.track}</strong>
                  <p>«{r.line}»</p>
                  <small>Грали: {s.session.names[r.team]}</small>
                </div>
                <span className={`history-award ${r.awarded ?? ""}`}>
                  {r.awarded ? (
                    <>
                      <b>+3</b>
                      {s.session.names[r.awarded]}
                    </>
                  ) : (
                    "Без балів"
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state">
            <FileText size={32} />
            Перший хіт ще попереду.
          </div>
        )}
      </Modal>
      <Modal
        open={sheet === "new_game"}
        onOpenChange={(v) => !v && setSheet(null)}
        title="Новий вечір — нова гра?"
        description="Рахунок та історія цієї партії обнуляться, програму вечора буде вимкнено. Назви команд, поточна музика й підключені екрани залишаться."
      >
        <div className="action-pair">
          <Button onClick={() => setSheet(null)}>Зберегти фінал</Button>
          <Button
            variant="primary"
            disabled={locked}
            onClick={() => {
              if (room.action({ type: "new_game" })) setSheet(null);
            }}
          >
            Почати нову гру
          </Button>
        </div>
      </Modal>
    </div>
  );
}
