import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  Copy,
  Eye,
  EyeOff,
  Lightbulb,
  LoaderCircle,
  LogOut,
  Maximize2,
  Monitor,
  Music2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SkipForward,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button, Modal, Panel } from "./ui";
import Backdrop from "./Backdrop";
import { Brand } from "./Home";
import { AccountButton, useIdentity } from "../lib/identity";
import { contests, useParty, type Contest, type PartyView } from "../lib/party";
import { usePartyAudio } from "../lib/usePartyAudio";
import PartyVote, { VoteModePicker } from "./PartyVote";
import PartySound, { TVSoundGate } from "./PartySound";
import WakeSlider from "./react-bits/WakeSlider";
import CountUp from "./react-bits/CountUp/CountUp";
import type { Team } from "../lib/music";

export default function PartyScreen() {
  const { user, openAccount } = useIdentity();
  const party = useParty();
  const s = party.state;
  const [setup, setSetup] = useState(party.initialCode ? "join" : "create");
  const [name, setName] = useState(
    () => user?.displayName || localStorage.getItem("khz:guest-name") || "",
  );
  const [code, setCode] = useState(party.initialCode);
  const [team, setTeam] = useState<Team>("girls");
  const [names, setNames] = useState({ girls: "Дівчата", boys: "Хлопці" });
  const [rounds, setRounds] = useState(10);
  const [voteMode, setVoteMode] = useState<"team" | "players">("team");
  const [types, setTypes] = useState<Contest[]>(contests.map((c) => c.id));
  const [sheet, setSheet] = useState<
    "invite" | "leave" | "settings" | "finish" | null
  >(null);
  const [guess, setGuess] = useState("");
  const [privateOpen, setPrivateOpen] = useState(false);
  const [stageOnly, setStageOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = party.serverNow;
  const busy = party.status === "connecting" || party.status === "reconnecting";
  const host = !!s?.you?.host;
  const online = party.status === "connected";
  const canAct =
    online &&
    !s?.paused &&
    s?.stage === "playing" &&
    !!s.you &&
    (host || s.you.team === s.activeTeam);
  const [notice, setNotice] = useState("");
  const sound = usePartyAudio(party, setNotice);
  const player = sound.player;
  useEffect(() => {
    if (user && !name) setName(user.displayName);
  }, [user]);
  useEffect(() => {
    setGuess("");
    setPrivateOpen(false);
    setNotice("");
  }, [s?.roundIndex, s?.stage]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const configure = (event: React.FormEvent) => {
    event.preventDefault();
    const nickname = name.trim() || user?.displayName || "";
    if (nickname.length < 2 || Array.from(nickname).length > 32) {
      party.setError("Додай ім’я від 2 до 32 символів.");
      return;
    }
    localStorage.setItem("khz:guest-name", nickname);
    if (setup === "join") {
      const roomCode = code.trim().toUpperCase();
      if (!/^[A-Z2-9]{5}$/.test(roomCode)) {
        party.setError("Потрібен код із 5 латинських літер і цифр.");
        return;
      }
      party.enter("join", { code: roomCode, name: nickname, team });
    } else {
      if (!types.length) {
        party.setError("Обери хоча б один конкурс.");
        return;
      }
      if (!names.girls.trim() || !names.boys.trim()) {
        party.setError("Назви обидві команди.");
        return;
      }
      party.enter("create_room", {
        hostName: nickname,
        hostTeam: team,
        girlsName: names.girls.trim(),
        boysName: names.boys.trim(),
        rounds,
        roundTypes: types,
        preset: "party",
        voteMode,
      });
    }
  };
  const toggleType = (type: Contest) =>
    setTypes((previous) =>
      previous.includes(type)
        ? previous.length > 1
          ? previous.filter((v) => v !== type)
          : previous
        : [...previous, type],
    );
  const inviteURL = s ? `${location.origin}/?screen=party&code=${s.code}` : "";
  const audienceURL = `${inviteURL}&watch=1`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteURL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Копіювання недоступне. Код можна переписати з екрана.");
    }
  };
  const metadata = contests.find((c) => c.id === s?.roundType);
  const remaining = s?.paused
    ? Math.ceil((s.remainingMs || 0) / 1000)
    : s?.deadlineMs
      ? Math.max(0, Math.ceil((s.deadlineMs - now) / 1000))
      : 0;
  const melodyPoints = Math.max(
    1,
    (remaining > 25 ? 3 : remaining > 10 ? 2 : 1) -
      (s?.round?.hints?.length || 0),
  );
  const startMelody = () => {
    if (host && online) party.action("resume");
  };
  const expand = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice("Повноекранний режим недоступний у цьому браузері.");
    }
  };
  if (!s && party.watching)
    return (
      <div className="app-shell party-shell viewer-wait-shell">
        <Backdrop effects={false} />
        <audio ref={player.ref} preload="metadata" />
        <Panel className="viewer-wait">
          <Monitor size={38} />
          <h1>
            {party.error
              ? "Не вдалося відкрити сцену"
              : "Підключаємо вашу сцену"}
          </h1>
          <p role={party.error ? "alert" : "status"}>
            {party.error || "Зачекайте, поки екран приєднається до кімнати."}
          </p>
          <a href="/" className="button button-soft">
            На головну
            <ArrowLeft size={18} />
          </a>
        </Panel>
      </div>
    );
  return (
    <div
      className={`app-shell party-shell ${host && s?.media?.output === "tv" ? "party-remote-host" : ""} ${stageOnly || party.watching ? "party-stage-only" : ""}`}
    >
      <Backdrop effects={localStorage.getItem("khz:effects") !== "off"} />
      <audio ref={player.ref} preload="metadata" />
      <header className="site-header party-header">
        <Brand />
        <nav aria-label="Навігація гри">
          <a href="/?screen=studio">
            <Music2 size={17} /> Музична студія
          </a>
          <span className="party-nav-active">
            <Users size={18} /> Вечір конкурсів
          </span>
        </nav>
        <div className="header-actions">
          <AccountButton />
          {s && !party.watching && (
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="Вийти з кімнати"
              onClick={() => setSheet("leave")}
            >
              <LogOut size={19} />
            </Button>
          )}
        </div>
      </header>
      {!s ? (
        <main className="party-setup">
          <div className="party-setup-title">
            <a href="/" className="back-link">
              <ArrowLeft size={16} /> Усі формати
            </a>
            <span className="section-label">
              <Sparkles size={17} /> УЛЮБЛЕНА КОМПАНІЯ. НОВИЙ АЗАРТ.
            </span>
            <h1>
              СЬОГОДНІ
              <br />
              <span>
                ХТОСЬ БУДЕ
                <br />
                ЗВЕРХУ.
              </span>
            </h1>
            <p>
              Змішуй конкурси, збирай дві команди
              <br />
              та веди свій вечір у власному темпі.
            </p>
            <div className="setup-decor" aria-hidden="true">
              <span>А</span>
              <AudioLines size={55} />
              <span>?</span>
            </div>
          </div>
          <Panel className="party-setup-panel">
            <div
              className="account-tabs"
              role="group"
              aria-label="Участь у грі"
            >
              <Button
                className={setup === "create" ? "selected" : ""}
                onClick={() => {
                  setSetup("create");
                  party.setError("");
                }}
                disabled={busy}
                aria-pressed={setup === "create"}
              >
                Створити гру
              </Button>
              <Button
                className={setup === "join" ? "selected" : ""}
                onClick={() => {
                  setSetup("join");
                  party.setError("");
                }}
                disabled={busy}
                aria-pressed={setup === "join"}
              >
                Маю код
              </Button>
            </div>
            <form className="account-form" noValidate onSubmit={configure}>
              <label className="field-label">
                {setup === "create" ? "Ім’я ведучого" : "Твоє ім’я"}
                <input
                  autoComplete="nickname"
                  placeholder="Як тебе називати?"
                  maxLength={32}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {setup === "join" ? (
                <label className="field-label">
                  Код кімнати
                  <input
                    className="room-code-input"
                    value={code}
                    onChange={(e) =>
                      setCode(
                        e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""),
                      )
                    }
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="КОД ГРИ"
                    maxLength={5}
                    disabled={busy}
                  />
                </label>
              ) : (
                <>
                  <div className="setup-team-names">
                    {(["girls", "boys"] as Team[]).map((t) => (
                      <label key={t} className={`field-label field-${t}`}>
                        {t === "girls" ? "Команда 01" : "Команда 02"}
                        <input
                          value={names[t]}
                          onChange={(e) =>
                            setNames({ ...names, [t]: e.target.value })
                          }
                          maxLength={32}
                          disabled={busy}
                        />
                      </label>
                    ))}
                  </div>
                  <VoteModePicker
                    value={voteMode}
                    onChange={setVoteMode}
                    disabled={busy}
                  />
                  <div className="field-label">
                    Скільки раундів?
                    <div className="choice-row">
                      {[5, 10, 15, 20].map((n) => (
                        <Button
                          key={n}
                          className={rounds === n ? "selected" : ""}
                          aria-pressed={rounds === n}
                          disabled={busy}
                          onClick={() => setRounds(n)}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="field-label">
                    Конкурси у грі
                    <div className="contest-options">
                      {contests.map((c) => (
                        <Button
                          key={c.id}
                          className={types.includes(c.id) ? "selected" : ""}
                          aria-pressed={types.includes(c.id)}
                          disabled={busy}
                          onClick={() => toggleType(c.id)}
                        >
                          <span className="custom-check">
                            {types.includes(c.id) && <Check size={13} />}
                          </span>
                          {c.title}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="field-label">
                {setup === "create" ? "Хто починає?" : "Твоя команда"}
                <div className="team-choice">
                  {(["girls", "boys"] as Team[]).map((t) => (
                    <Button
                      key={t}
                      className={`${t} ${team === t ? "selected" : ""}`}
                      aria-pressed={team === t}
                      disabled={busy}
                      onClick={() => setTeam(t)}
                    >
                      {t === "girls" ? names.girls : names.boys}
                      {team === t && <Check size={17} />}
                    </Button>
                  ))}
                </div>
              </div>
              {party.error && (
                <p className="form-error" role="alert">
                  {party.error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                className="account-submit"
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle size={20} className="spin" />
                ) : (
                  <ArrowRight size={20} />
                )}
                {busy
                  ? "Під’єднуємося…"
                  : setup === "create"
                    ? "Зібрати компанію"
                    : "Приєднатися до гри"}
              </Button>
              <p className="account-footnote">
                <ShieldCheck size={16} />
                {user
                  ? `Граєш як ${user.displayName}. Результат збережеться в історії.`
                  : "Граєш гостем. Акаунт не потрібен."}
              </p>
            </form>
          </Panel>
        </main>
      ) : (
        <main className="party-main">
          <div className="party-room-bar">
            <div>
              <span className={`connection-dot ${online ? "online" : ""}`} />
              <span>
                {online
                  ? party.watching
                    ? "Глядацький екран"
                    : host
                      ? "Пульт ведучого"
                      : `Грає ${s.you?.name || "гравець"}`
                  : "Відновлюємо зв’язок…"}
              </span>
            </div>
            <Button variant="ghost" onClick={() => setSheet("invite")}>
              <Radio size={16} />
              Код <b>{s.code}</b>
              <Copy size={14} />
            </Button>
            {!party.watching && (
              <Button variant="ghost" onClick={() => setStageOnly(!stageOnly)}>
                <Monitor size={17} />
                {stageOnly ? "Показати пульт" : "Залишити сцену"}
              </Button>
            )}
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="Повний екран"
              onClick={expand}
            >
              <Maximize2 size={18} />
            </Button>
          </div>
          <div className="party-scoreboard">
            {(["girls", "boys"] as Team[]).map((t, index) => (
              <div
                key={t}
                className={`party-team-score ${t} ${s.activeTeam === t && s.stage !== "final" ? "active" : ""}`}
              >
                <span className="party-team-symbol">
                  {index === 0 ? <Sparkles size={25} /> : <Zap size={25} />}
                </span>
                <div>
                  <span className="section-label">КОМАНДА 0{index + 1}</span>
                  <h2>{s.teams[t].name}</h2>
                  <span className="party-team-caption">
                    {s.stage === "final"
                      ? "Фінальний рахунок"
                      : s.activeTeam === t
                        ? "Ваш вихід"
                        : "Наступними — ви"}
                  </span>
                </div>
                <strong>
                  <CountUp
                    to={s.teams[t].score}
                    duration={0.45}
                    trigger="load"
                  />
                </strong>
              </div>
            ))}
            <span className="party-versus">VS</span>
          </div>
          {party.error && (
            <div className="party-error" role="alert">
              <p>{party.error}</p>
              <Button
                variant="ghost"
                className="icon-button"
                aria-label="Сховати повідомлення"
                onClick={() => party.setError("")}
              >
                <X size={16} />
              </Button>
            </div>
          )}
          <div className="party-game-grid">
            <Panel
              className={`party-stage stage-${s.stage} ${s.paused ? "is-paused" : ""}`}
            >
              <div className="party-stage-top">
                <span>
                  <span className="live-dot" />
                  {s.stage === "lobby"
                    ? "ЗБИРАЄМО КОМПАНІЮ"
                    : s.stage === "final"
                      ? "ФІНАЛ ВЕЧОРА"
                      : metadata?.label}
                </span>
                <span>
                  {s.stage !== "lobby" && `${s.roundIndex} / ${s.rounds}`}
                </span>
              </div>
              {s.stage === "lobby" ? (
                <div className="party-lobby-stage">
                  <div className="party-lobby-orb" aria-hidden="true">
                    <Users size={58} />
                  </div>
                  <span className="section-label">КОД ВАШОГО ВЕЧОРА</span>
                  <h2>{s.code}</h2>
                  <p>
                    Обирайте команду. Вмощуйтеся зручніше.
                    <br />
                    Ведучий почне, коли всі будуть готові.
                  </p>
                  <div className="lobby-deck">
                    {s.config.roundTypes.map((t) => (
                      <span key={t}>
                        {contests.find((c) => c.id === t)?.title}
                      </span>
                    ))}
                  </div>
                  <span className="lobby-rounds">
                    {s.rounds} раундів · Дві команди · Один переможець
                  </span>
                </div>
              ) : s.stage === "final" ? (
                <div className="party-final-stage">
                  <Trophy size={55} />
                  <span className="section-label">ОЦЕ БУВ ВЕЧІР</span>
                  <h2>
                    {s.winner ? (
                      <>
                        ЗВЕРХУ —<br />
                        <span className={s.winner}>
                          {s.teams[s.winner].name}!
                        </span>
                      </>
                    ) : (
                      <>
                        ПЕРЕМОГЛА
                        <br />
                        <span>ДРУЖБА!</span>
                      </>
                    )}
                  </h2>
                  <p>
                    {s.winner
                      ? "А реванш завжди починається з наступної гри."
                      : "Нічия. Здається, потрібен ще один вечір."}
                  </p>
                  <strong>
                    {s.teams.girls.score} <i>:</i> {s.teams.boys.score}
                  </strong>
                </div>
              ) : s.stage === "result" ? (
                <div
                  className={`party-result-stage ${s.result?.won ? "result-won" : ""}`}
                >
                  <span className="party-result-symbol">
                    {s.result?.won ? (
                      <CheckCheck size={39} />
                    ) : (
                      <Music2 size={38} />
                    )}
                  </span>
                  <span className="section-label">
                    {s.result?.won
                      ? "КОМАНДА ЗАБИРАЄ БАЛИ"
                      : "ЦЬОГО РАЗУ БЕЗ БАЛІВ"}
                  </span>
                  <h2>{s.result?.answer}</h2>
                  <p>{s.result?.detail}</p>
                  {s.result?.voting && (
                    <div className="vote-result-summary">
                      <span>
                        Правда <b>{s.result.voting.truth}</b>
                      </span>
                      <span>
                        Брехня <b>{s.result.voting.lie}</b>
                      </span>
                      <p>
                        {s.result.voting.outcome === "tie"
                          ? "Голоси навпіл. Цього разу без балів."
                          : s.result.voting.outcome === "empty"
                            ? "Команда не встигла проголосувати."
                            : `Рішення більшості · ${s.result.voting.cast} з ${s.result.voting.eligible} голосів`}
                      </p>
                    </div>
                  )}
                  <div className="party-result-points">
                    +{s.result?.points || 0}
                    <span>{s.teams[s.result?.team || s.activeTeam].name}</span>
                  </div>
                </div>
              ) : (
                <div className="party-live-stage">
                  <div className="party-round-heading">
                    <div>
                      <span className={`team-chip ${s.activeTeam}`}>
                        {s.teams[s.activeTeam].name}
                      </span>
                      <h2>{metadata?.title}</h2>
                    </div>
                    {s.deadlineMs || s.remainingMs ? (
                      <div
                        className={`party-clock ${remaining <= 10 ? "urgent" : ""}`}
                      >
                        <strong>{remaining}</strong>
                        <span>{s.paused ? "ПАУЗА" : "СЕКУНД"}</span>
                      </div>
                    ) : (
                      <span className="points-chip">
                        до {s.round?.potential || 0} балів
                      </span>
                    )}
                  </div>
                  {s.roundType === "five_words" && (
                    <>
                      <p className="contest-instruction">
                        Відкривайте слова. Яка пісня тут ховається?
                      </p>
                      <div className="word-slots">
                        {s.round?.slots?.map((slot, i) => (
                          <Button
                            key={i}
                            className={
                              slot.revealed ? "word-revealed" : "word-hidden"
                            }
                            aria-label={
                              slot.revealed
                                ? slot.word
                                : `Відкрити слово ${i + 1}`
                            }
                            disabled={slot.revealed || !canAct}
                            onClick={() => party.action("reveal", { index: i })}
                          >
                            {slot.revealed ? (
                              slot.word
                            ) : (
                              <>
                                <span>0{i + 1}</span>
                                <Eye size={22} />
                              </>
                            )}
                          </Button>
                        ))}
                      </div>
                      <span className="potential-caption">
                        Зараз на кону {s.round?.potential} балів
                      </span>
                    </>
                  )}
                  {s.roundType === "melody" && (
                    <div className="melody-stage">
                      <div
                        className={`melody-disc ${s.media?.playing ? "spinning" : ""}`}
                        aria-hidden="true"
                      >
                        <DiscIcon />
                      </div>
                      <h3>Знайомий мотив?</h3>
                      <p>Назвіть пісню та виконавця.</p>
                      {host && (
                        <>
                          <Button
                            variant="primary"
                            disabled={
                              !s.media?.ready ||
                              !online ||
                              s.paused ||
                              party.pending
                            }
                            onClick={() => {
                              party.action(
                                s.media?.playing ? "pause" : "audio_replay",
                              );
                            }}
                          >
                            {s.media?.playing ? (
                              <Pause size={22} />
                            ) : (
                              <Play size={22} fill="currentColor" />
                            )}
                            {!s.round?.previewUrl
                              ? s.round?.previewStatus === "unavailable"
                                ? "Фрагмент недоступний"
                                : "Шукаємо фрагмент…"
                              : s.media?.playing
                                ? "Пауза музики"
                                : "Слухати фрагмент"}
                          </Button>
                          <span className="potential-caption">
                            {s.media?.output === "tv"
                              ? "Звук на TV"
                              : "Звук на пульті"}{" "}
                            · {melodyPoints} бали · швидша відповідь дає більше
                          </span>
                        </>
                      )}
                      {s.round?.hints?.map((hint) => (
                        <p className="public-hint" key={hint}>
                          {hint}
                        </p>
                      ))}
                    </div>
                  )}
                  {s.roundType === "crocodile" && (
                    <div className="emoji-stage">
                      <div>{s.round?.emoji}</div>
                      <h3>Що тут зашифровано?</h3>
                      {s.round?.hint && (
                        <p className="public-hint">{s.round.hint}</p>
                      )}
                      <span className="potential-caption">
                        На кону {s.round?.potential} бали
                      </span>
                    </div>
                  )}
                  {s.roundType === "truth_lie" && (
                    <div className="truth-stage">
                      <span className="truth-quote">“</span>
                      <h3>{s.round?.statement}</h3>
                      <PartyVote
                        state={s}
                        online={online}
                        pending={party.pending}
                        action={party.action}
                      />
                    </div>
                  )}
                  {s.roundType === "alias" && (
                    <div className="alias-stage">
                      <span className="section-label">
                        ПОЯСНЮЄ {s.round?.explainerName || "ВЕДУЧИЙ"}
                      </span>
                      <h3>
                        Те саме.
                        <br />
                        <span>Іншими словами.</span>
                      </h3>
                      <p>
                        Пояснюй уголос. Команда відгадує.
                        <br />
                        Приватна картка — на пульті того, хто пояснює.
                      </p>
                      <div className="alias-progress">
                        <strong>
                          {s.round?.scored || 0}
                          <span>ВІДГАДАНО</span>
                        </strong>
                        <i>/</i>
                        <strong>
                          {s.round?.total || 0}
                          <span>СЛІВ У РАУНДІ</span>
                        </strong>
                      </div>
                    </div>
                  )}
                  {s.paused && (
                    <div className="party-pause-overlay">
                      {s.round?.awaitingAudio ? (
                        <Music2 size={34} />
                      ) : (
                        <Pause size={34} />
                      )}
                      <h3>
                        {s.round?.awaitingAudio
                          ? "Ловимо хвилю"
                          : "Перепочинок"}
                      </h3>
                      <p>
                        {s.round?.awaitingAudio
                          ? s.round.previewStatus === "unavailable"
                            ? "Цей фрагмент недоступний. Ведучий може наспівати пісню або завершити раунд без балів."
                            : "Ведучий увімкне фрагмент. Тоді почнеться відлік часу."
                          : "Ведучий продовжить гру, коли всі будуть готові."}
                      </p>
                      {host && (
                        <Button
                          variant="primary"
                          disabled={
                            !online ||
                            party.pending ||
                            !!s.media?.pending ||
                            (s.roundType === "melody" &&
                              !s.media?.ready &&
                              s.round?.previewStatus !== "unavailable")
                          }
                          onClick={() =>
                            s.round?.awaitingAudio
                              ? void startMelody()
                              : party.action("resume")
                          }
                        >
                          <Play size={18} />
                          {s.round?.awaitingAudio
                            ? s.round.previewStatus === "unavailable"
                              ? "Грати з наспівом ведучого"
                              : s.media?.ready
                                ? "Увімкнути й почати"
                                : "Завантажуємо фрагмент…"
                            : "Продовжити гру"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {party.isTV && (
                <TVSoundGate
                  armed={sound.armed}
                  online={online}
                  selected={s.media?.output === "tv"}
                  allowSound={sound.allowSound}
                />
              )}
            </Panel>
            {!party.watching && (
              <aside className="party-controls">
                {host && s.config.roundTypes.includes("melody") && (
                  <PartySound
                    state={s}
                    tvToken={party.tvToken}
                    online={online}
                    pending={party.pending}
                    armed={sound.armed}
                    ownerHere={sound.ownerHere}
                    allowSound={sound.allowSound}
                    action={party.action}
                    onNotice={setNotice}
                  />
                )}
                <Panel className="party-control-panel">
                  <div className="section-label">
                    {host ? <ShieldCheck size={17} /> : <Users size={17} />}
                    {host
                      ? "ТВОЯ ГРА. ТВІЙ ТЕМП."
                      : "ТВОЯ КОМАНДА. ТВІЙ ВИХІД."}
                  </div>
                  {s.stage === "lobby" ? (
                    <>
                      <h3>{host ? "Усі зібралися?" : "Вже майже починаємо"}</h3>
                      <p>
                        {host
                          ? "Запроси друзів або веди гру для двох команд із цього пристрою."
                          : "Можеш змінити команду, поки ведучий не почав гру."}
                      </p>
                      <Button onClick={() => setSheet("invite")}>
                        <Smartphone size={19} />
                        Запросити компанію
                      </Button>
                      {!host && (
                        <div className="team-choice">
                          {(["girls", "boys"] as Team[]).map((t) => (
                            <Button
                              key={t}
                              className={`${t} ${s.you?.team === t ? "selected" : ""}`}
                              disabled={!online || party.pending}
                              onClick={() =>
                                party.send("set_team", { team: t })
                              }
                            >
                              {s.teams[t].name}
                            </Button>
                          ))}
                        </div>
                      )}
                      {host && (
                        <>
                          <Button
                            variant="primary"
                            className="party-primary-action"
                            disabled={!online || party.pending}
                            onClick={() => party.send("start_game")}
                          >
                            <Play size={20} fill="currentColor" />
                            Почати вечір
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setRounds(s.rounds);
                              setTypes(s.config.roundTypes);
                              setVoteMode(s.config.voteMode || "team");
                              setSheet("settings");
                            }}
                          >
                            <Settings2 size={17} />
                            Конкурси та раунди
                          </Button>
                        </>
                      )}
                    </>
                  ) : s.stage === "final" ? (
                    <>
                      <Trophy size={31} />
                      <h3>Було гаряче!</h3>
                      <p>
                        {s.you?.registered
                          ? "Результат акаунта зберігається в історії після завершення."
                          : "Ця гра була гостьовою. Увійди перед наступною, щоб зберігати результати."}
                      </p>
                      {user ? (
                        <Button onClick={() => openAccount("profile")}>
                          Мій профіль
                          <ArrowRight size={18} />
                        </Button>
                      ) : (
                        <Button onClick={() => openAccount("register")}>
                          Створити акаунт
                          <ArrowRight size={18} />
                        </Button>
                      )}
                      {host && (
                        <Button
                          variant="primary"
                          disabled={!online || party.pending}
                          onClick={() => party.action("lobby")}
                        >
                          <RotateCcw size={18} />
                          Граємо ще
                        </Button>
                      )}
                    </>
                  ) : s.stage === "result" ? (
                    <>
                      <h3>
                        {s.result?.won
                          ? "Є контакт!"
                          : "Буває. Рухаємось далі."}
                      </h3>
                      <p>
                        Команда «{s.teams[s.activeTeam].name}» отримує{" "}
                        {s.result?.points || 0} балів.
                      </p>
                      {host ? (
                        <Button
                          variant="primary"
                          className="party-primary-action"
                          disabled={!online || party.pending}
                          onClick={() => party.action("next")}
                        >
                          {s.roundIndex >= s.rounds ? (
                            <Trophy size={19} />
                          ) : (
                            <ArrowRight size={19} />
                          )}
                          {s.roundIndex >= s.rounds
                            ? "Показати фінал"
                            : "Наступний конкурс"}
                        </Button>
                      ) : (
                        <p className="waiting-note">
                          Чекаємо, поки ведучий продовжить.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <h3>
                        {s.teams[s.activeTeam].name},<br />
                        ваш вихід
                      </h3>
                      <p>{metadata?.description}</p>
                      {(s.round?.hostAnswer || s.round?.current) && (
                        <div className="private-card">
                          <Button
                            variant="ghost"
                            onClick={() => setPrivateOpen(!privateOpen)}
                            aria-expanded={privateOpen}
                          >
                            {privateOpen ? (
                              <EyeOff size={17} />
                            ) : (
                              <Eye size={17} />
                            )}
                            {privateOpen
                              ? "Приховати картку"
                              : "Показати приватну картку"}
                          </Button>
                          {privateOpen && (
                            <div>
                              <span className="section-label">
                                ЛИШЕ ДЛЯ{" "}
                                {s.round.current
                                  ? "ТОГО, ХТО ПОЯСНЮЄ"
                                  : "ВЕДУЧОГО"}
                              </span>
                              <h4>
                                {s.round.current?.word || s.round.hostAnswer}
                              </h4>
                              {!!s.round.current?.taboo?.length && (
                                <p>
                                  Не можна казати:{" "}
                                  <b>{s.round.current.taboo.join(", ")}</b>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {s.roundType === "alias" && s.round?.current ? (
                        <div className="alias-host-controls">
                          <Button
                            variant="primary"
                            disabled={!canAct || party.pending}
                            onClick={() => party.action("correct")}
                          >
                            <Check size={21} />
                            Відгадали
                          </Button>
                          <Button
                            disabled={!canAct || party.pending}
                            onClick={() => party.action("skip")}
                          >
                            <SkipForward size={19} />
                            Пропустити слово
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!canAct || party.pending}
                            onClick={() => party.action("end")}
                          >
                            Завершити пояснення
                          </Button>
                        </div>
                      ) : s.roundType !== "truth_lie" && canAct ? (
                        <>
                          {host && (
                            <div className="verdict-buttons">
                              <Button
                                variant="primary"
                                disabled={
                                  s.roundType === "five_words" &&
                                  !s.round?.slots?.some((slot) => slot.revealed)
                                }
                                onClick={() =>
                                  party.action("force", { won: true })
                                }
                              >
                                <Check size={20} />
                                Відгадали
                              </Button>
                              <Button
                                onClick={() =>
                                  party.action("force", { won: false })
                                }
                              >
                                <X size={20} />
                                Не цього разу
                              </Button>
                            </div>
                          )}
                          {s.roundType !== "alias" && (
                            <form
                              noValidate
                              className="party-guess"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (guess.trim()) {
                                  if (
                                    party.action("guess", {
                                      text: guess.trim(),
                                    })
                                  )
                                    setGuess("");
                                }
                              }}
                            >
                              <label className="field-label">
                                Або введіть відповідь
                                <input
                                  value={guess}
                                  onChange={(e) => setGuess(e.target.value)}
                                  placeholder="Ваша версія…"
                                  maxLength={200}
                                />
                              </label>
                              <Button
                                type="submit"
                                disabled={!guess.trim() || party.pending}
                                aria-label="Надіслати відповідь"
                              >
                                <ArrowRight size={20} />
                              </Button>
                            </form>
                          )}
                          {(s.roundType === "melody" ||
                            s.roundType === "crocodile") && (
                            <Button
                              disabled={
                                s.roundType === "melody"
                                  ? (s.round?.hints?.length || 0) >= 2
                                  : !!s.round?.hint
                              }
                              onClick={() => party.action("hint")}
                            >
                              <Lightbulb size={18} />
                              Підказка · менше балів
                            </Button>
                          )}
                        </>
                      ) : null}
                      {host &&
                        s.roundType === "truth_lie" &&
                        s.round?.voting?.mode === "players" && (
                          <Button
                            disabled={!online || s.paused || party.pending}
                            onClick={() => party.action("close_vote")}
                          >
                            <CheckCheck size={18} />
                            Підбити голоси
                          </Button>
                        )}
                      {host && !s.round?.awaitingAudio && (
                        <div className="party-pause-control">
                          <Button
                            disabled={!online || party.pending}
                            onClick={() =>
                              party.action(s.paused ? "resume" : "pause")
                            }
                          >
                            {s.paused ? (
                              <Play size={18} />
                            ) : (
                              <Pause size={18} />
                            )}
                            {s.paused ? "Продовжити гру" : "Пауза гри"}
                          </Button>
                        </div>
                      )}
                      {host && (
                        <Button
                          variant="ghost"
                          className="finish-link"
                          onClick={() => setSheet("finish")}
                        >
                          Завершити вечір достроково
                        </Button>
                      )}
                    </>
                  )}
                </Panel>
                <Panel className="party-players">
                  <div className="section-label">
                    <Users size={16} />
                    КОМПАНІЯ{" "}
                    <span>{s.players.filter((p) => p.connected).length}</span>
                  </div>
                  {(["girls", "boys"] as Team[]).map((t) => (
                    <div className={`party-roster ${t}`} key={t}>
                      <h4>{s.teams[t].name}</h4>
                      {s.players
                        .filter((p) => p.team === t)
                        .map((p) => (
                          <div key={p.id}>
                            <span
                              className={`connection-dot ${p.connected ? "online" : ""}`}
                            />
                            <span>{p.name}</span>
                            {p.host && <ShieldCheck size={14} />}
                          </div>
                        ))}
                    </div>
                  ))}
                </Panel>
              </aside>
            )}
          </div>
          {s.stage === "final" && !!s.history?.length && (
            <Panel className="party-match-history">
              <span className="section-label">ЯК ЦЕ БУЛО</span>
              <h3>Кожен бал має історію</h3>
              <ol>
                {s.history.map((r) => (
                  <li key={r.round}>
                    <b>{String(r.round).padStart(2, "0")}</b>
                    <div>
                      <span>
                        {contests.find((c) => c.id === r.type)?.title} ·{" "}
                        {s.teams[r.result.team].name}
                      </span>
                      <strong>{r.result.answer}</strong>
                    </div>
                    <span>+{r.result.points}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </main>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <Modal
        open={sheet === "invite"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="Збирай своїх"
        description="Команди приєднуються за кодом або цим QR. Це гостьове посилання, воно не передає керування ведучого."
      >
        <div className="party-invite">
          <div className="invite-qr">
            <QRCodeSVG
              value={inviteURL}
              size={178}
              bgColor="#f3eaff"
              fgColor="#21152c"
              level="M"
            />
          </div>
          <strong>{s?.code}</strong>
          <Button onClick={copy}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? "Посилання скопійовано" : "Скопіювати запрошення"}
          </Button>
          <a
            className="button button-soft"
            href={audienceURL}
            target="_blank"
            rel="noopener"
          >
            <Monitor size={18} />
            Відкрити глядацьку сцену
            <ArrowRight size={18} />
          </a>
          <p>
            Для іншого пристрою потрібна доступна йому адреса. localhost
            відкривається лише на поточному комп’ютері.
          </p>
        </div>
      </Modal>
      <Modal
        open={sheet === "leave"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="Залишити кімнату?"
        description={
          host
            ? "Якщо ведучий вийде під час раунду, гра стане на паузу. Після виходу з цього пристрою його ключ буде видалено."
            : "Ти вийдеш із гри на цьому пристрої."
        }
      >
        <div className="dialog-actions">
          <Button onClick={() => setSheet(null)}>Залишитися</Button>
          <Button
            variant="danger"
            onClick={() => {
              player.pause();
              party.leave();
              setSheet(null);
            }}
          >
            Вийти з гри
          </Button>
        </div>
      </Modal>
      <Modal
        open={sheet === "finish"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="Уже фінал?"
        description="Завершені раунди залишаться в підсумках. Поточний незавершений конкурс не додасть балів."
      >
        <div className="dialog-actions">
          <Button onClick={() => setSheet(null)}>Ще граємо</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (party.action("finish")) setSheet(null);
            }}
          >
            Показати фінал
            <Trophy size={18} />
          </Button>
        </div>
      </Modal>
      <Modal
        open={sheet === "settings"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="Налаштуй вечір"
        description="Конкурси чергуватимуться в обраному порядку."
      >
        <div className="account-form">
          <VoteModePicker value={voteMode} onChange={setVoteMode} />
          <div className="field-label">
            Кількість раундів
            <div className="choice-row">
              {[5, 10, 15, 20].map((n) => (
                <Button
                  key={n}
                  className={rounds === n ? "selected" : ""}
                  aria-pressed={rounds === n}
                  onClick={() => setRounds(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
          <div className="contest-options">
            {contests.map((c) => (
              <Button
                key={c.id}
                className={types.includes(c.id) ? "selected" : ""}
                aria-pressed={types.includes(c.id)}
                onClick={() => toggleType(c.id)}
              >
                <span className="custom-check">
                  {types.includes(c.id) && <Check size={13} />}
                </span>
                {c.title}
              </Button>
            ))}
          </div>
          <Button
            variant="primary"
            onClick={() => {
              if (
                party.send("set_config", {
                  rounds,
                  roundTypes: types,
                  preset: "party",
                  voteMode,
                })
              )
                setSheet(null);
            }}
          >
            Готово
            <Check size={18} />
          </Button>
        </div>
      </Modal>
    </div>
  );
}
function DiscIcon() {
  return (
    <>
      <span />
      <i />
      <Music2 size={35} />
    </>
  );
}
