import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePWA } from "./lib/pwa";
import { get, set, setMany, del } from "idb-keyval";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookmarkPlus,
  Check,
  ChevronRight,
  CircleHelp,
  Disc3,
  Expand,
  FileText,
  Headphones,
  LoaderCircle,
  ListMusic,
  Minus,
  Monitor,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SkipBack,
  Sparkles,
  Trophy,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
  Smartphone,
} from "lucide-react";
import { Button, Modal, Panel } from "./components/ui";
import Backdrop from "./components/Backdrop";
import WakeSlider from "./components/react-bits/WakeSlider";
import SquishSwitch from "./components/react-bits/SquishSwitch";
import ShowStage, { Scoreboard } from "./components/ShowStage";
import { useShowBroadcast, type ShowState } from "./lib/show";
import { useAnswerClock } from "./lib/useAnswerClock";
import { scoreRound, undoRound, nextPlayableTarget } from "./lib/match";
import {
  activeCue,
  api,
  curated,
  formatTime,
  freshSession,
  parseLRC,
  restoreSession,
  type Phase,
  type Team,
  type Track,
} from "./lib/music";
import { usePlayer } from "./lib/usePlayer";
import NetworkStation from "./components/NetworkStation";
import { savedRoom, rememberRoom, type RoomAccess } from "./lib/studioRoom";
import { AccountButton, useIdentity } from "./lib/identity";
import LocalArchive from "./components/LocalArchive";
import WordTimingEditor from "./components/WordTimingEditor";
import { serializeLyrics, timingCount } from "./lib/wordTiming";
import type { WordCue } from "./lib/music";
import PreparedSongs from "./components/PreparedSongs";
import ProgrammeEditor from "./components/ProgrammeEditor";
import ProgrammeOrder from "./components/ProgrammeOrder";
import LyricTimingStatus from "./components/LyricTimingStatus";
import { sameCueTimeline } from "./lib/lyricTimeline";
import {
  emptyProgramme,
  readProgramme,
  saveProgramme,
  validProgramme,
  type Programme,
} from "./lib/programme";
import "./programme.css";
import {
  listPrepared,
  readPrepared,
  savePrepared,
  removePrepared,
  validPrepared,
  refreshPreparedPreview,
  type PreparedSummary,
} from "./lib/preparedSongs";

type Sheet =
  | "library"
  | "programme"
  | "programme_order"
  | "settings"
  | "help"
  | "cues"
  | "words"
  | "reset"
  | "history"
  | "connect"
  | null;
type LocalAudio = { file: Blob; trackId: number };
export default function App() {
  const identity = useIdentity();
  const [network, setNetwork] = useState<RoomAccess | null>(savedRoom);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [session, setSession] = useState(restoreSession);
  const latestSession = useRef(session);
  latestSession.current = session;
  const [track, setTrack] = useState<Track | null>(null);
  const [trackBusy, setTrackBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>(() =>
    session.finished
      ? "final"
      : session.history.some((r) => r.round === session.round)
        ? "result"
        : "ready",
  );
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState("");
  const [effects, setEffects] = useState(
    () => localStorage.getItem("khz:effects") !== "off",
  );
  const [stageOnly, setStageOnly] = useState(false);
  const [audioURL, setAudioURL] = useState("");
  const [localAudio, setLocalAudio] = useState<LocalAudio | null>(null);
  const [preparedSongs, setPreparedSongs] = useState<PreparedSummary[]>([]);
  const [preparedBusy, setPreparedBusy] = useState(false);
  const [preparedLoaded, setPreparedLoaded] = useState(false);
  const [programmeDraft, setProgrammeDraft] =
    useState<Programme>(emptyProgramme);
  const [awarded, setAwarded] = useState<Team | null>(
    () =>
      session.history.find((r) => r.round === session.round)?.awarded ?? null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [cueQuery, setCueQuery] = useState("");
  const [wordLine, setWordLine] = useState(0);
  const [lyricsConfigured, setLyricsConfigured] = useState<boolean | null>(
    null,
  );
  const audioFile = useRef<HTMLInputElement>(null),
    lrcFile = useRef<HTMLInputElement>(null);
  const interactionUntil = useRef(0);
  const requestVersion = useRef(0),
    advancing = useRef(false),
    scoreLock = useRef(false),
    targetLock = useRef(false);
  const tell = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    let live = true;
    void Promise.all([
      listPrepared(),
      readProgramme().catch(() => {
        tell(
          "Чернетку програми не вдалося прочитати. Підготовлені пісні залишаються у бібліотеці.",
        );
        return emptyProgramme();
      }),
    ])
      .then(([songs, draft]) => {
        if (live) {
          setPreparedSongs(songs);
          setProgrammeDraft(draft);
          setPreparedLoaded(true);
        }
      })
      .catch((e) => {
        if (live) tell(e.message);
      });
    return () => {
      live = false;
    };
  }, [tell]);
  const player = usePlayer(audioURL, tell);
  const {
    needRefresh: [needsUpdate],
    updateServiceWorker,
  } = usePWA();
  const [installEvent, setInstallEvent] = useState<
    (Event & { prompt: () => Promise<void> }) | null
  >(null);
  const cues = track?.cues ?? [];
  const nowMS = player.position * 1000 + session.offset;
  const current = session.aligned ? activeCue(cues, nowMS) : -1;
  const target = cues[session.target];
  const answerClock = useAnswerClock(phase === "answer", session.answerSeconds);
  const recorded = session.history.find((r) => r.round === session.round);
  const scene: ShowState = {
    eventName: session.programme?.title,
    scores: session.scores,
    names: session.names,
    team: session.team,
    round: session.round,
    rounds: session.rounds,
    phase,
    playing: player.playing,
    nowMS,
    lyric: current >= 0 && current < session.target ? cues[current].text : "",
    words:
      current >= 0 && current < session.target
        ? cues[current].words
        : undefined,
    ...(phase === "result" || phase === "final"
      ? {
          answer: recorded?.line ?? target?.text,
          track:
            recorded?.track ?? `${track?.artist ?? ""} · ${track?.title ?? ""}`,
        }
      : {}),
    awarded,
    remaining: answerClock.remaining,
    timerPaused: answerClock.paused,
    effects,
  };
  const audienceURL = useShowBroadcast(scene, !network);
  const createNetwork = async () => {
    if (
      !track ||
      !player.ready ||
      !["ready", "result", "final"].includes(phase)
    )
      return;
    player.pause();
    setNetworkBusy(true);
    setNetworkError("");
    try {
      const response = await fetch("/api/studio/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          track,
          effects,
          audio: {
            position: player.position,
            duration: player.duration,
            playing: false,
            ready: false,
            local: !!localAudio,
            volume: player.volume,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json();
      if (!response.ok)
        throw Error(body.error || "Не вдалося підключити пульт.");
      rememberRoom(body);
      setNetwork(body);
      setSheet(null);
    } catch (error) {
      setNetworkError(
        error instanceof Error
          ? error.message
          : "Сервер недоступний. Спробуй ще раз.",
      );
    } finally {
      setNetworkBusy(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("khz:studio:v1", JSON.stringify(session));
  }, [session]);
  useEffect(() => {
    localStorage.setItem("khz:effects", effects ? "on" : "off");
  }, [effects]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    api<{ lyricsConfigured: boolean }>("/api/music/status")
      .then((s) => setLyricsConfigured(s.lyricsConfigured))
      .catch(() => setLyricsConfigured(false));
  }, []);
  useEffect(() => {
    const cb = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", cb);
    return () => window.removeEventListener("beforeinstallprompt", cb);
  }, []);
  useEffect(() => {
    return () => {
      if (audioURL.startsWith("blob:")) URL.revokeObjectURL(audioURL);
    };
  }, [audioURL]);
  const loadTrack = useCallback(
    async (id: number, preserve = false, prepared = false) => {
      const version = ++requestVersion.current;
      setTrackBusy(true);
      const completed = latestSession.current.history.find(
        (r) => r.round === latestSession.current.round,
      );
      try {
        let preparation = prepared ? await readPrepared(id) : null;
        if (prepared && !preparation)
          throw new Error(
            "Підготовку не знайдено на цьому пристрої. Обери іншу пісню.",
          );
        if (preparation)
          preparation = await refreshPreparedPreview(preparation, (id) =>
            api<Track>(`/api/music/track?id=${id}`),
          );
        if (version !== requestVersion.current) return false;
        setPhase(
          latestSession.current.finished
            ? "final"
            : completed
              ? "result"
              : "ready",
        );
        setAwarded(completed?.awarded ?? null);
        scoreLock.current = !!completed;
        targetLock.current = false;
        setTrack(null);
        setAudioURL("");
        setLocalAudio(null);
        if (preparation) {
          const saved = preparation;
          if (version !== requestVersion.current) return false;
          const audio = saved.file ? { trackId: id, file: saved.file } : null;
          try {
            await setMany([
              [`khz:track:${id}`, saved.track],
              [`khz:lrc:${id}`, saved.track.cues],
              ["khz:audio", audio ?? undefined],
            ]);
          } catch {
            if (version === requestVersion.current)
              tell(
                "Підготовку відкрито. Перевір вільне місце перед наступними збереженнями.",
              );
          }
          if (version !== requestVersion.current) return false;
          setTrack(saved.track);
          setLocalAudio(audio);
          setAudioURL(
            audio ? URL.createObjectURL(audio.file) : saved.track.preview,
          );
          setSession((s) => ({
            ...s,
            programme: preserve ? s.programme : undefined,
            trackId: id,
            offset: saved.offset,
            target: saved.target,
            aligned: true,
          }));
          return true;
        }
        let value: Track;
        const previous = await get<Track>(`khz:track:${id}`).catch(
          () => undefined,
        );
        try {
          value = await api<Track>(`/api/music/track?id=${id}`);
        } catch (error) {
          const cached = await get<Track>(`khz:track:${id}`).catch(
            () => undefined,
          );
          const saved = await get<LocalAudio>("khz:audio").catch(
            () => undefined,
          );
          if (!cached || saved?.trackId !== id) throw error;
          value = cached;
          tell("Без мережі: відновлено твій аудіофайл і збережений текст.");
        }
        if (version !== requestVersion.current) return;
        const imported = await get<Track["cues"]>(`khz:lrc:${id}`).catch(
          () => undefined,
        );
        if (imported?.length)
          value = { ...value, cues: imported, lyricsStatus: "imported" };
        const retimed =
          preserve && !sameCueTimeline(previous?.cues, value.cues);
        setTrack(value);
        void set(`khz:track:${id}`, value).catch(() => {});
        const saved = await get<LocalAudio>("khz:audio").catch(() => undefined);
        if (version !== requestVersion.current) return;
        if (saved?.trackId === id) {
          setLocalAudio(saved);
          setAudioURL(URL.createObjectURL(saved.file));
        } else setAudioURL(value.preview);
        setSession((s) => ({
          ...s,
          programme: preserve ? s.programme : undefined,
          trackId: id,
          ...(preserve
            ? {
                target: Math.min(s.target, Math.max(0, value.cues.length - 1)),
                aligned: retimed ? false : s.aligned,
              }
            : {
                aligned: false,
                offset: 0,
                target: Math.min(3, Math.max(0, value.cues.length - 1)),
              }),
        }));
        if (retimed && latestSession.current.aligned)
          tell(
            "Часова шкала тексту оновилася. Перевір прив’язку до аудіо перед наступним раундом.",
          );
        return true;
      } catch (error) {
        if (version === requestVersion.current)
          tell(
            error instanceof Error
              ? error.message
              : "Не вдалося завантажити трек.",
          );
        return false;
      } finally {
        if (version === requestVersion.current) setTrackBusy(false);
      }
    },
    [tell],
  );
  useEffect(() => {
    void loadTrack(session.trackId, true, !!session.programme);
    return () => {
      requestVersion.current++;
    };
  }, [loadTrack]); // restore once; future track changes are explicit

  useEffect(() => {
    if (
      phase !== "playing" ||
      !session.aligned ||
      !target ||
      targetLock.current
    )
      return;
    if (nowMS >= target.startMs) {
      targetLock.current = true;
      player.pause();
      setPhase("answer");
    }
  }, [phase, nowMS, session.aligned, target, player.pause]);
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchBusy(false);
      setSearchError("");
      return;
    }
    const ctrl = new AbortController();
    setSearchBusy(true);
    setSearchError("");
    const timeout = setTimeout(
      () =>
        api<{ tracks: Track[] }>(
          `/api/music/search?q=${encodeURIComponent(query)}`,
          ctrl.signal,
        )
          .then((v) => {
            setResults(v.tracks);
            setSearchBusy(false);
          })
          .catch((e) => {
            if (!ctrl.signal.aborted) {
              setSearchError(e.message);
              setSearchBusy(false);
            }
          }),
      350,
    );
    return () => {
      clearTimeout(timeout);
      ctrl.abort();
    };
  }, [query]);

  const resetRound = () => {
    player.pause();
    const completed = session.history.find((r) => r.round === session.round);
    setPhase(session.finished ? "final" : completed ? "result" : "ready");
    setAwarded(completed?.awarded ?? null);
    scoreLock.current = !!completed;
    targetLock.current = false;
  };
  const currentPreparation =
    track && session.aligned && player.ready
      ? {
          schema: 1 as const,
          track,
          offset: session.offset,
          target: session.target,
          duration: player.duration,
          ...(localAudio ? { file: localAudio.file } : {}),
          savedAt: Date.now(),
        }
      : null;
  const canPrepare =
    phase === "ready" &&
    !trackBusy &&
    !!currentPreparation &&
    validPrepared(currentPreparation);
  const savePreparation = async () => {
    if (!canPrepare || !currentPreparation || preparedBusy) return;
    setPreparedBusy(true);
    try {
      await savePrepared(currentPreparation);
      setPreparedSongs(await listPrepared());
      tell("Пісню підготовлено. Відкривай її з розділу «Готові до гри».");
    } catch (e) {
      tell(e instanceof Error ? e.message : "Не вдалося зберегти підготовку.");
    } finally {
      setPreparedBusy(false);
    }
  };
  const deletePreparation = async (id: number) => {
    setPreparedBusy(true);
    try {
      await removePrepared(id);
      setPreparedSongs(await listPrepared());
      tell("Підготовку прибрано з набору.");
    } catch (e) {
      tell(e instanceof Error ? e.message : "Не вдалося прибрати підготовку.");
      throw e;
    } finally {
      setPreparedBusy(false);
    }
  };
  const saveProgrammeDraft = async (value: Programme) => {
    setPreparedBusy(true);
    try {
      await saveProgramme(value);
      setProgrammeDraft({
        title: value.title.trim(),
        trackIds: [...value.trackIds],
      });
    } finally {
      setPreparedBusy(false);
    }
  };
  const startProgramme = async (value: Programme) => {
    if (
      !validProgramme(value) ||
      preparedBusy ||
      trackBusy ||
      !["ready", "result", "final"].includes(phase)
    )
      return;
    setPreparedBusy(true);
    try {
      for (const id of value.trackIds) {
        if (!(await readPrepared(id)))
          throw new Error(
            "Не всі пісні підготовлені на цьому пристрої. Віднови їх або зміни програму.",
          );
      }
      await saveProgramme(value);
      const programme = {
        title: value.title.trim(),
        trackIds: [...value.trackIds],
      };
      setProgrammeDraft(programme);
      if (!(await loadTrack(value.trackIds[0], false, true)))
        throw new Error(
          "Не вдалося відкрити першу підготовку. Поточна гра збережена.",
        );
      player.pause();
      setSession((s) => ({
        ...freshSession(),
        names: s.names,
        answerSeconds: s.answerSeconds,
        trackId: s.trackId,
        offset: s.offset,
        target: s.target,
        aligned: s.aligned,
        rounds: value.trackIds.length,
        programme,
      }));
      scoreLock.current = false;
      targetLock.current = false;
      setPhase("ready");
      setAwarded(null);
      setSheet(null);
      tell("Програму підготовлено. Починай перший раунд, коли команди готові.");
    } finally {
      setPreparedBusy(false);
    }
  };
  const startRound = () => {
    if (session.history.some((r) => r.round === session.round)) {
      setPhase("result");
      return;
    }
    if (!session.aligned || !target || !player.ready) return;
    const start = (target.startMs - session.offset) / 1000 - 7;
    const stop = (target.startMs - session.offset) / 1000;
    if (stop <= 0.3 || stop > player.duration - 0.2) {
      tell("Цей рядок поза межами аудіо. Обери інший або додай повний запис.");
      return;
    }
    player.seek(Math.max(0, start));
    if (
      session.round === 1 &&
      session.history.length === 0 &&
      session.ownerAccountId === null
    ) {
      setSession((s) => ({ ...s, ownerAccountId: identity.user?.id ?? null }));
    }
    scoreLock.current = false;
    targetLock.current = false;
    setAwarded(null);
    setPhase("playing");
    void player.play();
  };
  const award = (team: Team | null) => {
    if (
      scoreLock.current ||
      phase !== "answer" ||
      session.history.some((r) => r.round === session.round)
    )
      return;
    interactionUntil.current = performance.now() + 1200;
    scoreLock.current = true;
    player.pause();
    setAwarded(team);
    setPhase("result");
    setSession((s) =>
      scoreRound(s, {
        round: s.round,
        team: s.team,
        awarded: team,
        track: `${track?.artist ?? ""} · ${track?.title ?? ""}`,
        line: target?.text ?? "",
        trackId: s.trackId,
        target: s.target,
      }),
    );
  };
  const nextRound = async (event?: { detail: number }) => {
    if (trackBusy || !player.ready || advancing.current) return;
    if (
      phase !== "result" ||
      (event && event.detail > 1) ||
      performance.now() < interactionUntil.current
    )
      return;
    if (session.round >= session.rounds) {
      player.pause();
      setPhase("final");
      setSession((s) => ({ ...s, finished: true }));
      return;
    }
    if (session.programme) {
      const nextId = session.programme.trackIds[session.round];
      if (!nextId) return;
      advancing.current = true;
      try {
        player.pause();
        if (!(await loadTrack(nextId, true, true))) return;
        setSession((s) => ({
          ...s,
          round: s.round + 1,
          team: s.team === "girls" ? "boys" : "girls",
        }));
        setPhase("ready");
        setAwarded(null);
        scoreLock.current = false;
        targetLock.current = false;
      } finally {
        advancing.current = false;
      }
      return;
    }
    resetRound();
    setPhase("ready");
    setAwarded(null);
    scoreLock.current = false;
    const next = nextPlayableTarget(
      cues,
      session.offset,
      player.duration,
      session.target,
      cues.flatMap((cue, i) =>
        session.history.some(
          (r) => r.trackId === session.trackId && r.line === cue.text,
        )
          ? [i]
          : [],
      ),
    );
    setSession((s) => ({
      ...s,
      round: s.round + 1,
      team: s.team === "girls" ? "boys" : "girls",
      target: next ?? 0,
      aligned: next !== null && s.aligned,
    }));
    if (next === null) {
      setSheet("library");
      tell(
        "У цьому аудіо більше немає нових рядків для гри. Обери іншу пісню.",
      );
    }
  };
  const align = (index: number) => {
    const cue = cues[index];
    if (!cue) return;
    resetRound();
    setSession((s) => ({
      ...s,
      offset: Math.round(cue.startMs - player.position * 1000),
      aligned: true,
      target: Math.min(index + 2, cues.length - 1),
    }));
    setSheet(null);
    tell("Рядок прив’язано. Перевір збіг музики й тексту перед грою.");
  };
  const uploadAudio = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) {
      tell("Обери аудіофайл до 150 МБ.");
      return;
    }
    if (
      !file.type.startsWith("audio/") &&
      !/\.(mp3|wav|m4a|ogg|flac|aac|opus|webm)$/i.test(file.name)
    ) {
      tell("Це не схоже на аудіофайл. Обери MP3, WAV, M4A, OGG або FLAC.");
      return;
    }
    if (!track) {
      tell("Спочатку обери трек із бібліотеки.");
      return;
    }
    resetRound();
    setLocalAudio({ file, trackId: track.id });
    setAudioURL(URL.createObjectURL(file));
    // Full-track timelines are absolute; matching edition must be checked by the host.
    setSession((s) => ({ ...s, offset: 0, aligned: false }));
    try {
      await set("khz:audio", { file, trackId: track.id });
      tell(
        "Аудіо збережено на цьому пристрої. Перевір синхронізацію й підтвердь прив’язку.",
      );
    } catch {
      tell("Файл відкрито. Бракує місця для його збереження між сеансами.");
    }
  };
  const uploadLRC = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !track) return;
    if (file.size > 1_000_000) {
      tell("Файл тексту має бути меншим за 1 МБ.");
      return;
    }
    const imported = parseLRC(await file.text());
    if (!imported.length) {
      tell("У файлі немає рядків із часовими мітками LRC.");
      return;
    }
    resetRound();
    const updated = { ...track, cues: imported, lyricsStatus: "imported" };
    setTrack(updated);
    setSession((s) => ({
      ...s,
      target: Math.min(3, imported.length - 1),
      offset: 0,
      aligned: false,
    }));
    try {
      await set(`khz:lrc:${track.id}`, imported);
      await set(`khz:track:${track.id}`, updated);
    } catch {
      tell("Текст відкрито, але браузер не зміг зберегти його між сеансами.");
      return;
    }
    tell(`Імпортовано ${imported.length} рядків. Перевір прив’язку до аудіо.`);
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      tell("Цей браузер не підтримує повноекранний режим.");
    }
  };
  const saveWordTiming = async (words: WordCue[] | undefined) => {
    if (!track || !track.cues[wordLine]) return false;
    const updated: Track = {
      ...track,
      lyricsStatus: "imported",
      cues: track.cues.map((cue, index) =>
        index === wordLine ? { ...cue, words } : cue,
      ),
    };
    try {
      await setMany([
        [`khz:lrc:${track.id}`, updated.cues],
        [`khz:track:${track.id}`, updated],
      ]);
    } catch {
      return false;
    }
    setTrack(updated);
    setSheet("cues");
    tell(
      words?.length
        ? "Мітки слів збережено. Перевір підсвічування й починай гру."
        : "Збережено синхронізацію рядка без міток слів.",
    );
    return true;
  };
  const exportLyrics = () => {
    if (!track?.cues.length) return;
    const url = URL.createObjectURL(
      new Blob([serializeLyrics(track.cues)], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${track.artist} - ${track.title}.lrc`.replace(
      /[<>:"/\\|?*\u0000-\u001f]/g,
      "_",
    );
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const liveActions = useRef({
    network: !!network,
    toggle: player.toggle,
    answerToggle: answerClock.toggle,
    start: startRound,
    phase,
    sheet,
    stageOnly,
  });
  liveActions.current = {
    network: !!network,
    toggle: player.toggle,
    answerToggle: answerClock.toggle,
    start: startRound,
    phase,
    sheet,
    stageOnly,
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches(
          'input,textarea,button,[role="slider"],[role="switch"]',
        ) ||
          e.target.isContentEditable)
      )
        return;
      if (liveActions.current.sheet) return;
      if (liveActions.current.network) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (liveActions.current.phase === "answer")
          liveActions.current.answerToggle();
        else if (
          liveActions.current.phase === "ready" ||
          liveActions.current.phase === "playing"
        )
          liveActions.current.toggle();
      }
      if (e.key === "Escape") setStageOnly(false);
      if (e.key.toLowerCase() === "f") void fullscreen();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const lyricProblem =
    track?.lyricsStatus === "reauth_required"
      ? "Підключення Deezer потребує оновлення."
      : track?.lyricsStatus === "unconfigured"
        ? "Для текстів потрібно підключити Deezer на сервері."
        : "Для цього запису немає синхронізованого тексту.";

  return (
    <>
      <audio ref={player.ref} preload="metadata" className="sr-only" />
      {network ? (
        <NetworkStation
          access={network}
          player={player}
          track={track}
          localAudio={!!localAudio}
          session={session}
          library={preparedLoaded ? preparedSongs : null}
          loadTrack={(id, prepared) => loadTrack(id, false, prepared)}
          onExit={(state) => {
            player.pause();
            rememberRoom(null);
            setNetwork(null);
            if (state) {
              setSession(state.session);
              setPhase(
                state.session.finished
                  ? "final"
                  : state.phase === "result"
                    ? "result"
                    : "ready",
              );
              setAwarded(state.awarded);
              setEffects(state.effects);
            }
            setSheet(null);
          }}
        />
      ) : (
        <div
          className={`app-shell ${stageOnly ? "stage-only" : ""} team-${session.team}`}
        >
          <Backdrop effects={effects} />
          <input
            ref={audioFile}
            className="sr-only"
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
            onChange={uploadAudio}
            aria-label="Додати аудіофайл"
          />
          <input
            ref={lrcFile}
            className="sr-only"
            type="file"
            accept=".lrc,text/plain"
            onChange={uploadLRC}
            aria-label="Додати текст LRC"
          />
          <header className="site-header">
            <a className="brand" href="/" aria-label="Хто зверху — головна">
              <span className="brand-icon">
                <Zap size={24} fill="currentColor" />
              </span>
              <span>
                хто
                <span className="brand-bottom">
                  зверху<span className="brand-dot">?</span>
                </span>
              </span>
            </a>
            <nav aria-label="Навігація студії">
              <Button
                variant="ghost"
                className="nav-active"
                onClick={() => setSheet(null)}
              >
                <AudioLines size={17} />
                Музична студія
              </Button>
              <Button variant="ghost" onClick={() => setSheet("library")}>
                Бібліотека треків
              </Button>
              <Button variant="ghost" onClick={() => setSheet("programme")}>
                <ListMusic size={17} /> Програма вечора
              </Button>
              <Button variant="ghost" onClick={() => setSheet("help")}>
                Як грати
                <CircleHelp size={15} />
              </Button>
              <Button variant="ghost" onClick={() => setSheet("history")}>
                Рахунок і раунди
              </Button>
            </nav>
            <div className="header-actions">
              <AccountButton />
              <span className="local-badge">
                <span className="status-dot" />
                Локальна гра
              </span>
              <Button
                variant="ghost"
                className="icon-button"
                aria-label="Налаштування"
                onClick={() => setSheet("settings")}
              >
                <Settings2 size={19} />
              </Button>
            </div>
          </header>

          <main>
            {session.programme && (
              <section
                className="programme-summary"
                aria-label="Поточна програма вечора"
              >
                <ListMusic size={24} />
                <div>
                  <strong>{session.programme.title}</strong>
                  <p>
                    {session.finished
                      ? `Програму завершено · ${session.rounds} раундів зіграно.`
                      : `Пісня ${session.round} з ${session.rounds} · Порядок записів підготовлено до гри.`}
                  </p>
                </div>
                <Button onClick={() => setSheet("programme_order")}>
                  Порядок вечора
                </Button>
                <Button
                  variant="ghost"
                  disabled={trackBusy || !["ready", "result"].includes(phase)}
                  onClick={() =>
                    setSession((s) => ({ ...s, programme: undefined }))
                  }
                >
                  Обирати пісні вручну
                </Button>
              </section>
            )}
            <section className="page-intro">
              <div>
                <p className="eyebrow">
                  <span />
                  ЗБИРАЙ СВОЇХ. ВМИКАЙ ШОУ.
                </p>
                <h1>
                  МУЗИКА <span>ВИРІШУЄ.</span>
                  <span className="title-star">✳</span>
                </h1>
                <p className="intro-copy">
                  Знайомі пісні. Незнайомий переможець.
                </p>
              </div>
              <div className="intro-side">
                <span className="prototype-label">
                  <Sparkles size={14} />
                  МУЗИЧНА БИТВА · СЕЗОН 01
                </span>
                <Button
                  onClick={() => {
                    player.pause();
                    setStageOnly(true);
                  }}
                >
                  <Monitor size={17} />
                  Екран шоу
                  <ArrowRight size={16} />
                </Button>
                <a
                  className="button specular-button button-ghost tv-open"
                  href={audienceURL}
                  target="_blank"
                  rel="noopener"
                >
                  <span className="specular-button__label">
                    <Expand size={18} />
                    Окреме вікно для TV
                  </span>
                </a>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNetworkError("");
                    setSheet("connect");
                  }}
                >
                  <Smartphone size={18} />
                  Пульт на телефоні
                </Button>
              </div>
            </section>

            <div className="studio-layout">
              <section className="show-column" aria-label="Сцена гри">
                <Scoreboard state={scene} />
                <ShowStage
                  state={scene}
                  onExpand={() => setStageOnly((v) => !v)}
                />
                <div className="stage-under">
                  <span>
                    <ShieldCheck size={15} />У режимі шоу пульт приховано
                  </span>
                  <span>
                    <kbd>Space</kbd> музика <kbd>F</kbd> повний екран
                  </span>
                </div>
                <div className="how-strip">
                  <span className="how-number">01</span>
                  <span>Слухаємо фрагмент</span>
                  <ChevronRight />
                  <span className="how-number">02</span>
                  <span>Продовжуємо пісню</span>
                  <ChevronRight />
                  <span className="how-number">03</span>
                  <span>Забираємо бали</span>
                </div>
              </section>

              <aside
                className="host-column"
                aria-label="Пульт ведучого"
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
                <Panel className="host-panel">
                  <div className="panel-title">
                    <span>
                      <Headphones size={17} />
                      Пульт ведучого
                    </span>
                    <span className="host-tag">ТІЛЬКИ ДЛЯ ТЕБЕ</span>
                  </div>
                  <div className="track-heading">
                    <div
                      className={`track-art ${player.playing ? "spinning" : ""}`}
                    >
                      {track?.cover ? (
                        <img src={track.cover} alt="Обкладинка альбому" />
                      ) : (
                        <Disc3 size={30} />
                      )}
                    </div>
                    <div className="track-info">
                      <strong>
                        {trackBusy
                          ? "Шукаємо музику…"
                          : track?.title || "Обери свою пісню"}
                      </strong>
                      <span>{track?.artist || "Твоя музична бібліотека"}</span>
                      <small>
                        {localAudio ? "ВЛАСНЕ АУДІО" : "DEEZER · ПРЕВ’Ю 30 С"}
                      </small>
                    </div>
                    <Button
                      variant="ghost"
                      className="icon-button"
                      aria-label="Змінити трек"
                      onClick={() => setSheet("library")}
                    >
                      <ChevronRight size={20} />
                    </Button>
                  </div>
                  <div className="source-options">
                    <Button
                      className={!localAudio ? "selected" : ""}
                      onClick={() => {
                        if (!track) return;
                        resetRound();
                        setLocalAudio(null);
                        setAudioURL(track.preview);
                        setSession((s) => ({
                          ...s,
                          aligned: false,
                          offset: 0,
                        }));
                        void del("khz:audio");
                      }}
                    >
                      <Disc3 size={14} />
                      Прев’ю
                    </Button>
                    <Button
                      className={localAudio ? "selected" : ""}
                      disabled={!track}
                      onClick={() => audioFile.current?.click()}
                    >
                      <Upload size={14} />
                      Мій аудіофайл
                    </Button>
                  </div>
                  <Button
                    className="save-prepared"
                    disabled={!canPrepare || preparedBusy}
                    onClick={() => void savePreparation()}
                  >
                    <BookmarkPlus size={17} />
                    {preparedBusy
                      ? "Зберігаємо…"
                      : preparedSongs.some((p) => p.id === track?.id)
                        ? "Оновити підготовку"
                        : "Зберегти підготовку"}
                  </Button>
                  <div className="transport">
                    <Button
                      variant="ghost"
                      className="icon-button"
                      disabled={
                        !player.ready || phase === "answer" || phase === "final"
                      }
                      onClick={() => player.seek(player.position - 5)}
                      aria-label="Назад на 5 секунд"
                    >
                      <SkipBack size={19} />
                    </Button>
                    <Button
                      className="play-button"
                      disabled={
                        !player.ready ||
                        trackBusy ||
                        phase === "answer" ||
                        phase === "final"
                      }
                      aria-label={
                        player.playing
                          ? "Призупинити музику"
                          : "Відтворити музику"
                      }
                      onClick={player.toggle}
                    >
                      {player.loading ? (
                        <LoaderCircle className="spin" size={24} />
                      ) : player.playing ? (
                        <Pause size={24} fill="currentColor" />
                      ) : (
                        <Play size={24} fill="currentColor" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      className="icon-button"
                      disabled={
                        !player.ready || phase === "answer" || phase === "final"
                      }
                      aria-label="На початок треку"
                      onClick={() => player.seek(0)}
                    >
                      <RotateCcw size={18} />
                    </Button>
                  </div>
                  <WakeSlider
                    value={player.position}
                    min={0}
                    max={Math.max(1, player.duration)}
                    step={0.1}
                    onChange={player.seek}
                    bars={44}
                    height={34}
                    restHeight={13}
                    fillColor="#c4b5ef"
                    crestColor="#f5dbfa"
                    trackColor="#37323f"
                    disabled={
                      !player.ready || phase === "answer" || phase === "final"
                    }
                    ariaLabel="Позиція аудіо"
                  />
                  <div className="time-labels">
                    <span>{formatTime(player.position)}</span>
                    <span>{formatTime(player.duration)}</span>
                  </div>
                  <div className="volume-row">
                    <Button
                      variant="ghost"
                      className="icon-button"
                      aria-label={
                        player.volume ? "Вимкнути звук" : "Увімкнути звук"
                      }
                      onClick={() => player.setVolume(player.volume ? 0 : 65)}
                    >
                      {player.volume ? (
                        <Volume2 size={16} />
                      ) : (
                        <VolumeX size={16} />
                      )}
                    </Button>
                    <WakeSlider
                      value={player.volume}
                      onChange={player.setVolume}
                      bars={23}
                      height={22}
                      restHeight={6}
                      fillColor="#a9a1b7"
                      trackColor="#34303d"
                      ariaLabel="Гучність"
                    />
                    <span>{player.volume}%</span>
                  </div>
                  <div className="panel-divider" />
                  <div className="section-label">
                    <span>МУЗИКА Й ТЕКСТ</span>
                    <span
                      className={`sync-status ${session.aligned ? "synced" : ""}`}
                    >
                      <span />
                      {session.aligned ? "Прив’язано" : "Потрібна прив’язка"}
                    </span>
                  </div>
                  {cues.length > 0 ? (
                    <>
                      <LyricTimingStatus
                        cues={cues}
                        imported={track?.lyricsStatus === "imported"}
                      />
                      <p className="host-note">
                        {session.aligned
                          ? "Текст слідує за музикою. Перед грою перевір потрібний фрагмент."
                          : "Увімкни фрагмент і прив’яжи рядок, який зараз чуєш."}
                      </p>
                      <Button
                        className="full-width sync-button"
                        onClick={() => {
                          setCueQuery("");
                          setSheet("cues");
                        }}
                      >
                        <AudioLines size={15} />
                        {session.aligned
                          ? "Рядки та прив’язка"
                          : "Прив’язати рядок"}
                        <ArrowRight size={15} />
                      </Button>
                    </>
                  ) : (
                    <div className="notice">
                      <FileText size={16} />
                      <span>
                        {trackBusy ? "Завантажуємо текст…" : lyricProblem}{" "}
                        <Button
                          variant="ghost"
                          disabled={!track}
                          onClick={() => lrcFile.current?.click()}
                        >
                          Додати LRC
                          <Upload size={12} />
                        </Button>
                      </span>
                    </div>
                  )}
                  <div className="panel-divider" />
                  <div className="section-label">
                    <span>РЯДОК ДЛЯ КОМАНДИ</span>
                    <span>+3 БАЛИ</span>
                  </div>
                  <Button
                    variant="ghost"
                    className="target-line"
                    disabled={!cues.length}
                    onClick={() => {
                      setCueQuery("");
                      setSheet("cues");
                    }}
                  >
                    <span>
                      <small>
                        {target
                          ? formatTime(target.startMs / 1000)
                          : "ОБЕРИ РЯДОК"}
                      </small>
                      <span>
                        {target?.text || "Тут з’явиться продовження пісні"}
                      </span>
                    </span>
                    <ChevronRight size={16} />
                  </Button>
                  {phase === "ready" && (
                    <Button
                      variant="primary"
                      className="full-width launch-button"
                      disabled={
                        !session.aligned ||
                        !target ||
                        !player.ready ||
                        trackBusy
                      }
                      onClick={startRound}
                    >
                      <Play size={16} fill="currentColor" />
                      Почати раунд
                      <ArrowRight size={16} />
                    </Button>
                  )}
                  {phase === "playing" && (
                    <div className="action-pair">
                      <Button onClick={player.toggle}>
                        {player.playing ? (
                          <Pause size={16} />
                        ) : (
                          <Play size={16} />
                        )}{" "}
                        {player.playing ? "Пауза" : "Продовжити"}
                      </Button>
                      <Button
                        onClick={() => {
                          player.pause();
                          targetLock.current = true;
                          setPhase("answer");
                        }}
                      >
                        Час відповіді
                      </Button>
                    </div>
                  )}
                  {phase === "answer" && (
                    <div className="answer-controls">
                      <div className="answer-timer-control">
                        <strong>{answerClock.remaining} с</strong>
                        <Button
                          onClick={answerClock.toggle}
                          disabled={answerClock.remaining === 0}
                        >
                          {answerClock.paused ? (
                            <Play size={16} />
                          ) : (
                            <Pause size={16} />
                          )}
                          {answerClock.paused
                            ? "Продовжити відлік"
                            : "Пауза відліку"}
                        </Button>
                      </div>
                      <span>Хто продовжив пісню?</span>
                      <div className="action-pair">
                        <Button
                          className="award-girls"
                          onClick={() => award("girls")}
                        >
                          <Check size={15} />
                          {session.names.girls}
                        </Button>
                        <Button
                          className="award-boys"
                          onClick={() => award("boys")}
                        >
                          <Check size={15} />
                          {session.names.boys}
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        className="full-width"
                        onClick={() => award(null)}
                      >
                        Цього разу ніхто
                      </Button>
                    </div>
                  )}
                  {phase === "result" && (
                    <>
                      <Button
                        variant="primary"
                        className="full-width launch-button"
                        onClick={nextRound}
                        disabled={trackBusy || !player.ready}
                      >
                        {session.round >= session.rounds
                          ? "Показати фінал"
                          : "Наступний раунд"}
                        <ArrowRight size={17} />
                      </Button>
                      <Button
                        className="full-width"
                        variant="ghost"
                        onClick={() => {
                          setSession(undoRound);
                          scoreLock.current = false;
                          setAwarded(null);
                          setPhase("answer");
                        }}
                      >
                        Виправити оцінку
                      </Button>
                    </>
                  )}
                  {phase === "final" && (
                    <div className="final-host">
                      <Trophy size={32} />
                      <h3>Це було шоу!</h3>
                      <p>
                        Зберегли всі {session.history.length} раундів цієї
                        партії.
                      </p>
                      <Button
                        className="full-width"
                        onClick={() => setSheet("history")}
                      >
                        Підсумки гри
                      </Button>
                      <Button
                        variant="primary"
                        className="full-width"
                        onClick={() => setSheet("reset")}
                      >
                        Граємо ще
                      </Button>
                      <LocalArchive
                        session={session}
                        onClaim={(id) =>
                          setSession((s) => ({ ...s, ownerAccountId: id }))
                        }
                      />
                    </div>
                  )}
                  <p className="local-save">
                    <span />
                    Рахунок зберігається на цьому пристрої
                  </p>
                </Panel>
                <div className="host-tip">
                  <span>✳</span>
                  <p>
                    <strong>Ведучий — це ти.</strong> Задай темп, підтримай
                    команди. Решту зробить музика.
                  </p>
                </div>
              </aside>
            </div>
          </main>
          <footer className="site-footer">
            <span>
              ХТО ЗВЕРХУ<span className="footer-dot">?</span> <i /> Зроблено для
              ваших вечорів
            </span>
            <Button variant="ghost" onClick={() => setSheet("help")}>
              Твоя компанія. Твоя сцена.
              <ArrowUpIcon />
            </Button>
          </footer>
          {stageOnly && (
            <div className="stage-exit">
              <Button onClick={() => setStageOnly(false)}>
                <ArrowLeft size={17} />
                Повернути пульт
              </Button>
              {phase === "ready" && (
                <Button
                  disabled={!session.aligned || !player.ready}
                  onClick={startRound}
                >
                  <Play size={15} />
                  Почати раунд
                </Button>
              )}
              {phase === "playing" && (
                <Button onClick={player.toggle}>
                  {player.playing ? <Pause size={15} /> : <Play size={15} />}{" "}
                  {player.playing ? "Пауза" : "Продовжити"}
                </Button>
              )}
              <Button
                aria-label="Повний екран"
                onClick={() => void fullscreen()}
              >
                <Expand size={17} />
              </Button>
            </div>
          )}

          <Modal
            open={sheet === "programme_order"}
            onOpenChange={(v) => !v && setSheet(null)}
            title={session.programme?.title ?? "Програма вечора"}
            description="Наступний запис підготується після оцінки раунду. Його відповіді залишаться прихованими для глядачів."
            wide
          >
            {session.programme && (
              <ProgrammeOrder
                programme={session.programme}
                songs={preparedSongs}
                round={session.finished ? session.round + 1 : session.round}
              />
            )}
          </Modal>
          <Modal
            open={sheet === "programme"}
            onOpenChange={(v) => !v && !preparedBusy && setSheet(null)}
            title="Програма вечора"
            description="Підготуй порядок пісень до приходу гостей. Кожна команда отримає свій хіт."
            wide
          >
            {sheet === "programme" && (
              <ProgrammeEditor
                initial={programmeDraft}
                songs={preparedSongs}
                busy={
                  preparedBusy ||
                  trackBusy ||
                  !["ready", "result", "final"].includes(phase)
                }
                replacing={
                  session.history.length > 0 ||
                  session.scores.girls > 0 ||
                  session.scores.boys > 0
                }
                onSave={saveProgrammeDraft}
                onStart={startProgramme}
              />
            )}
          </Modal>
          <Modal
            open={sheet === "library"}
            onOpenChange={(v) => !v && setSheet(null)}
            title="Що сьогодні співаємо?"
            description="Знайди трек або обери знайомий хіт. Конкретну версію запису перевіряємо перед грою."
            wide
          >
            <Button
              className="programme-open"
              onClick={() => setSheet("programme")}
            >
              <ListMusic size={18} /> Зібрати програму вечора{" "}
              <ArrowRight size={18} />
            </Button>
            <PreparedSongs
              songs={preparedSongs}
              busy={trackBusy || preparedBusy || phase !== "ready"}
              onLoad={(id) => {
                void loadTrack(id, false, true);
                setSheet(null);
              }}
              onRemove={deletePreparation}
            />
            <label className="search-field">
              <Search size={20} />
              <input
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Пісня або виконавець"
                aria-label="Пошук треку"
              />
              {query && (
                <Button
                  variant="ghost"
                  className="icon-button"
                  onClick={() => setQuery("")}
                  aria-label="Очистити пошук"
                >
                  <X size={16} />
                </Button>
              )}
            </label>
            <div className="library-caption">
              <span>
                {query ? "РЕЗУЛЬТАТИ ПОШУКУ" : "З ЦЬОГО МОЖНА ПОЧАТИ"}
              </span>
              {searchBusy && <LoaderCircle size={16} className="spin" />}
            </div>
            {searchError && (
              <p className="inline-error" role="alert">
                {searchError}
              </p>
            )}
            <div className="track-library">
              {query
                ? results.map((t) => (
                    <Button
                      key={t.id}
                      variant="ghost"
                      className="library-result"
                      onClick={() => {
                        void loadTrack(t.id);
                        setSheet(null);
                      }}
                    >
                      <img src={t.cover} alt="" />
                      <span>
                        <strong>{t.title}</strong>
                        <small>
                          {t.artist} · {t.album}
                        </small>
                      </span>
                      <span className="library-duration">
                        {formatTime(t.duration)}
                      </span>
                      <Plus size={17} />
                    </Button>
                  ))
                : curated.map((t, i) => (
                    <Panel className="curated-card" key={t.id}>
                      <div className={`curated-art art-${i}`}>
                        <Disc3 size={72} strokeWidth={0.7} />
                        <span>{String(i + 1).padStart(2, "0")}</span>
                      </div>
                      <span className="curated-mood">{t.mood}</span>
                      <h3>{t.title}</h3>
                      <p>{t.artist}</p>
                      <Button
                        className="full-width"
                        onClick={() => {
                          void loadTrack(t.id);
                          setSheet(null);
                        }}
                      >
                        Обрати трек
                        <ArrowRight size={15} />
                      </Button>
                    </Panel>
                  ))}
            </div>
            {query && !searchBusy && !searchError && !results.length && (
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
          </Modal>

          <Modal
            open={sheet === "cues"}
            onOpenChange={(v) => !v && setSheet(null)}
            title="Музика й текст — разом"
            description="Знайди рядок, який чуєш у плеєрі. Прив’язка зіставить його початок із поточною позицією аудіо."
            wide
          >
            <div className="cue-transport">
              <Button
                onClick={player.toggle}
                disabled={
                  !player.ready || phase === "answer" || phase === "final"
                }
              >
                {player.playing ? <Pause size={17} /> : <Play size={17} />}{" "}
                {player.playing ? "Пауза" : "Слухати"}
              </Button>
              <span className="mono">
                {formatTime(player.position)} / {formatTime(player.duration)}
              </span>
              {track?.lyricsStatus === "imported" && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!track) return;
                    await del(`khz:lrc:${track.id}`);
                    await loadTrack(track.id);
                    tell(
                      "Повернули текст Deezer. Прив’язку потрібно перевірити знову.",
                    );
                  }}
                >
                  Текст Deezer
                </Button>
              )}
              <Button variant="ghost" onClick={() => lrcFile.current?.click()}>
                <Upload size={15} />
                Свій LRC
              </Button>
              <Button
                variant="ghost"
                disabled={!cues.length}
                onClick={exportLyrics}
              >
                <ArrowDownToLine size={15} /> Зберегти LRC
              </Button>
            </div>
            <div className="offset-row">
              <span>
                Зміщення тексту{" "}
                <strong>{(session.offset / 1000).toFixed(1)} с</strong>
              </span>
              <div>
                <Button
                  className="icon-button"
                  aria-label="Зменшити зміщення на 100 мс"
                  onClick={() =>
                    setSession((s) => ({ ...s, offset: s.offset - 100 }))
                  }
                >
                  <Minus size={15} />
                </Button>
                <Button
                  className="icon-button"
                  aria-label="Збільшити зміщення на 100 мс"
                  onClick={() =>
                    setSession((s) => ({ ...s, offset: s.offset + 100 }))
                  }
                >
                  <Plus size={15} />
                </Button>
                <Button
                  disabled={!localAudio}
                  onClick={() => {
                    resetRound();
                    setSession((s) => ({ ...s, offset: 0, aligned: true }));
                    tell("Використовуємо оригінальну шкалу повного запису.");
                  }}
                >
                  Повний запис · 0 с
                </Button>
              </div>
            </div>
            <label className="search-field compact">
              <Search size={17} />
              <input
                value={cueQuery}
                onChange={(e) => setCueQuery(e.target.value)}
                placeholder="Знайти слова в пісні"
                aria-label="Пошук рядка"
              />
            </label>
            <div className="cue-list">
              {cues
                .map((cue, index) => ({ cue, index }))
                .filter(({ cue }) =>
                  cue.text
                    .toLocaleLowerCase("uk")
                    .includes(cueQuery.toLocaleLowerCase("uk")),
                )
                .map(({ cue, index }) => (
                  <div
                    key={`${cue.startMs}-${index}`}
                    className={`cue-row ${current === index ? "cue-current" : ""} ${session.target === index ? "cue-target" : ""}`}
                  >
                    <time>{formatTime(cue.startMs / 1000)}</time>
                    <span>
                      {cue.text}
                      {cue.words?.length ? (
                        <small className="cue-word-badge">
                          <Check size={12} /> {timingCount(cue.words.length)}
                        </small>
                      ) : null}
                    </span>
                    <Button
                      className="cue-word-button"
                      aria-label={`${cue.words?.length ? "Перевірити мітки" : "Розмітити слова"} рядка ${index + 1}`}
                      title="Мітки слів"
                      onClick={() => {
                        resetRound();
                        setWordLine(index);
                        setSheet("words");
                      }}
                    >
                      <AudioLines size={17} />
                      <span className="cue-word-label">Слова</span>
                    </Button>
                    <Button onClick={() => align(index)}>Прив’язати</Button>
                    <Button
                      variant={session.target === index ? "primary" : "soft"}
                      aria-label={`Загадати рядок ${index + 1}`}
                      onClick={() => {
                        resetRound();
                        setSession((s) => ({ ...s, target: index }));
                        setSheet(null);
                      }}
                    >
                      {session.target === index ? (
                        <Check size={15} />
                      ) : (
                        <Plus size={15} />
                      )}
                      <span className="cue-action-label">Загадати</span>
                    </Button>
                  </div>
                ))}
            </div>
            <p className="modal-footnote">
              «Прив’язати» — рядок, що звучить зараз. «Загадати» — рядок, який
              команда має продовжити. На сцені він залишається прихованим до
              результату. Кнопка з хвилею відкриває запис міток окремих слів.
            </p>
          </Modal>

          {sheet === "words" && cues[wordLine] && (
            <WordTimingEditor
              key={`${track?.id}:${wordLine}`}
              cue={cues[wordLine]}
              line={wordLine}
              offset={session.offset}
              aligned={session.aligned}
              player={player}
              providerWords={
                track?.lyricsStatus === "ready" &&
                !!cues[wordLine].words?.length
              }
              onSave={saveWordTiming}
              onClose={() => setSheet("cues")}
            />
          )}

          <Modal
            open={sheet === "connect"}
            onOpenChange={(v) => !v && !networkBusy && setSheet(null)}
            title="Гра на TV. Пульт у руці."
            description="Цей пристрій відтворюватиме музику й показуватиме сцену. Телефон ведучого керуватиме грою через сервер."
          >
            <ol className="help-steps">
              <li>
                <span>01</span>
                <div>
                  <strong>Підготуй пісню</strong>
                  <p>
                    Обери аудіо та текст тут. Власний файл залишиться на цьому
                    пристрої.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Відкрий пульт на телефоні</strong>
                  <p>
                    Отримаєш приватне посилання й QR-код. Передай їх тільки
                    ведучому.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Запускай шоу</strong>
                  <p>
                    Рахунок, оцінки й час відповіді узгоджує сервер для всіх
                    екранів.
                  </p>
                </div>
              </li>
            </ol>
            <Button
              variant="primary"
              className="full-width"
              disabled={
                networkBusy ||
                !track?.cues.length ||
                !player.ready ||
                !["ready", "result", "final"].includes(phase)
              }
              onClick={() => void createNetwork()}
            >
              <Smartphone size={18} />
              {networkBusy ? "Підключаємо…" : "Підключити телефон"}
            </Button>
            {!["ready", "result", "final"].includes(phase) && (
              <p className="modal-footnote">Спочатку заверши поточний раунд.</p>
            )}
            {networkError && (
              <p className="inline-error" role="alert">
                {networkError}
              </p>
            )}
          </Modal>
          <Modal
            open={sheet === "history"}
            onOpenChange={(v) => !v && setSheet(null)}
            title="Кожен хіт — у рахунок"
            description={`${session.history.length} із ${session.rounds} раундів зіграно. За влучне продовження — 3 бали.`}
            wide
          >
            <div className="history-score">
              <span className="girls">
                {session.names.girls}
                <b>{session.scores.girls}</b>
              </span>
              <i>:</i>
              <span className="boys">
                <b>{session.scores.boys}</b>
                {session.names.boys}
              </span>
            </div>
            {!session.history.length ? (
              <div className="empty-state">
                <Trophy size={32} />
                <p>Перший хіт ще попереду.</p>
              </div>
            ) : (
              <ol className="round-history">
                {session.history.map((r) => (
                  <li key={r.round}>
                    <span className="history-number">
                      {String(r.round).padStart(2, "0")}
                    </span>
                    <div>
                      <strong>{r.track}</strong>
                      <p>«{r.line}»</p>
                      <small>Грали: {session.names[r.team]}</small>
                    </div>
                    <span className={`history-award ${r.awarded ?? ""}`}>
                      {r.awarded ? (
                        <>
                          <b>+3</b>
                          {session.names[r.awarded]}
                        </>
                      ) : (
                        "Без балів"
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Modal>
          <Modal
            open={sheet === "settings"}
            onOpenChange={(v) => !v && setSheet(null)}
            title="Твоя гра — твій настрій"
            description="Команди, оформлення та керування цим сеансом."
          >
            <div className="settings-teams">
              {(["girls", "boys"] as Team[]).map((team) => (
                <label key={team} className={team}>
                  <span>
                    Назва {team === "girls" ? "рожевої" : "синьої"} команди
                  </span>
                  <input
                    maxLength={32}
                    value={session.names[team]}
                    onChange={(e) =>
                      setSession((s) => ({
                        ...s,
                        names: { ...s.names, [team]: e.target.value },
                      }))
                    }
                  />
                  <div className="score-edit">
                    <Button
                      className="icon-button"
                      aria-label={`Зменшити рахунок: ${session.names[team]}`}
                      disabled={session.scores[team] <= 0}
                      onClick={() =>
                        setSession((s) => ({
                          ...s,
                          scores: {
                            ...s.scores,
                            [team]: Math.max(0, s.scores[team] - 1),
                          },
                        }))
                      }
                    >
                      <Minus size={15} />
                    </Button>
                    <span>{session.scores[team]} балів</span>
                    <Button
                      className="icon-button"
                      aria-label={`Збільшити рахунок: ${session.names[team]}`}
                      onClick={() =>
                        setSession((s) => ({
                          ...s,
                          scores: { ...s.scores, [team]: s.scores[team] + 1 },
                        }))
                      }
                    >
                      <Plus size={15} />
                    </Button>
                  </div>
                </label>
              ))}
            </div>
            <div className="setting-row">
              <span>
                <strong>Довжина партії</strong>
                <small>Однакова кількість ходів для команд</small>
              </span>
              <div className="option-grid">
                {[4, 8, 12, 16].map((n) => (
                  <Button
                    key={n}
                    disabled={session.history.length > 0 || !!session.programme}
                    className={session.rounds === n ? "selected" : ""}
                    onClick={() => setSession((s) => ({ ...s, rounds: n }))}
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
                    disabled={phase === "answer"}
                    className={session.answerSeconds === n ? "selected" : ""}
                    onClick={() =>
                      setSession((s) => ({ ...s, answerSeconds: n }))
                    }
                  >
                    {n} с
                  </Button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <span>
                <strong>Атмосферні ефекти</strong>
                <small>Живе світло й анімація сцени</small>
              </span>
              <SquishSwitch
                checked={effects}
                onChange={setEffects}
                width={48}
                height={28}
                ariaLabel="Атмосферні ефекти"
                trackOnColor="#a68de6"
              />
            </div>
            <div className="setting-row">
              <span>
                <strong>Хто починає?</strong>
                <small>Команда для поточного раунду</small>
              </span>
              <div className="action-pair">
                {(["girls", "boys"] as Team[]).map((team) => (
                  <Button
                    key={team}
                    className={session.team === team ? "selected" : ""}
                    onClick={() => {
                      resetRound();
                      setSession((s) => ({ ...s, team }));
                    }}
                  >
                    {team === "girls" ? "Рожеві" : "Сині"}
                  </Button>
                ))}
              </div>
            </div>
            {installEvent && (
              <Button
                className="full-width"
                onClick={() => void installEvent.prompt()}
              >
                <ArrowDownToLine size={17} />
                Встановити застосунок
              </Button>
            )}
            <Button className="full-width" onClick={() => setSheet("history")}>
              <Trophy size={17} />
              Рахунок і раунди
            </Button>
            <Button className="full-width" onClick={() => setSheet("help")}>
              <CircleHelp size={17} />
              Як грати
            </Button>
            <Button className="full-width" onClick={() => void fullscreen()}>
              <Expand size={17} />
              Повний екран
            </Button>
            {needsUpdate && (
              <Button
                className="full-width"
                disabled={phase === "playing"}
                onClick={() => void updateServiceWorker(true)}
              >
                Встановити готове оновлення
              </Button>
            )}
            <Button
              variant="danger"
              className="full-width"
              onClick={() => setSheet("reset")}
            >
              <RotateCcw size={16} />
              Почати нову гру
            </Button>
            <p className="modal-footnote">
              Гра й рахунок зберігаються на цьому пристрої.{" "}
              {lyricsConfigured
                ? "Тексти Deezer підключено."
                : "Тексти Deezer потребують серверного підключення."}{" "}
              Після перезавантаження музика залишається на паузі.
            </p>
          </Modal>

          <Modal
            open={sheet === "reset"}
            onOpenChange={(v) => !v && setSheet(null)}
            title="Новий вечір — нова гра?"
            description="Обидві команди почнуть із нуля. Обраний трек залишиться, програму вечора буде вимкнено."
          >
            <div className="action-pair">
              <Button onClick={() => setSheet("settings")}>Зберегти гру</Button>
              <Button
                variant="primary"
                onClick={() => {
                  resetRound();
                  setPhase("ready");
                  setAwarded(null);
                  scoreLock.current = false;
                  setSession((s) => ({
                    ...freshSession(),
                    trackId: s.trackId,
                    names: s.names,
                    offset: s.offset,
                    aligned: s.aligned,
                    target: s.target,
                    rounds: s.rounds,
                    answerSeconds: s.answerSeconds,
                  }));
                  setSheet(null);
                }}
              >
                Обнулити рахунок
              </Button>
            </div>
          </Modal>
          <Modal
            open={sheet === "help"}
            onOpenChange={(v) => !v && setSheet(null)}
            title="Збирай своїх. Починайте шоу."
            description="Музичний прототип для одного ведучого та двох команд."
          >
            <ol className="help-steps">
              <li>
                <span>01</span>
                <div>
                  <strong>Обери знайому пісню</strong>
                  <p>
                    Знайди її в Deezer. Слухай прев’ю або додай повний аудіофайл
                    відповідного запису.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Поєднай музику з текстом</strong>
                  <p>
                    Увімкни музику, відкрий рядки й натисни «Прив’язати» на
                    початку рядка, який чуєш. Перевір збіг.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Загадай продовження</strong>
                  <p>
                    Обери наступний рядок кнопкою «Загадати». Раунд запустить
                    фрагмент за 7 секунд до нього й зупинить музику.
                  </p>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>Зарахуй відповідь</strong>
                  <p>
                    Команда співає наживо. Ведучий обирає, кому дати 3 бали, і
                    запускає наступний раунд.
                  </p>
                </div>
              </li>
            </ol>
            <div className="notice">
              <Monitor size={18} />
              <span>
                «Окреме вікно для TV» відкриє сцену в цьому браузері. Перенеси
                його на телевізор, а пульт залиш на ноутбуці. Для іншого
                пристрою обери «Пульт на телефоні» — він створить мережеву
                кімнату.
              </span>
            </div>
            <p className="modal-footnote">
              Текст Deezer має мітки рядків. Для підсвічування слів натисни
              іконку хвилі біля рядка та запиши мітки під музику. Їх можна
              поправити, зберегти на пристрої й експортувати у LRC. Повний
              захищений потік Deezer ще не інтегрований. Власні файли
              обробляються лише на твоєму пристрої.
            </p>
          </Modal>
          <AnimatePresence>
            {toast && (
              <motion.div
                role="status"
                className="toast"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
              >
                <span>{toast}</span>
                <Button
                  variant="ghost"
                  className="icon-button"
                  aria-label="Закрити повідомлення"
                  onClick={() => setToast("")}
                >
                  <X size={17} />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
function ArrowUpIcon() {
  return <ArrowRight size={14} style={{ transform: "rotate(-45deg)" }} />;
}
