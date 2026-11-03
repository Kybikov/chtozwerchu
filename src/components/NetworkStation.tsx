import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  Expand,
  Link2,
  Radio,
  Smartphone,
  Volume2,
  ArrowLeft,
  Check,
} from "lucide-react";
import { Button, Modal } from "./ui";
import StageControls from "./StageControls";
import { usePWAActivity } from "../lib/pwa";
import { PWAUpdateControl } from "./PWAUpdate";
import Backdrop from "./Backdrop";
import ShowStage, { Scoreboard } from "./ShowStage";
import {
  roomScene,
  roomURL,
  useStudioConnection,
  type RoomAccess,
  type RoomState,
  type Instruction,
} from "../lib/studioRoom";
import type { Session, Track } from "../lib/music";
import type { usePlayer } from "../lib/usePlayer";
import type { PreparedSummary } from "../lib/preparedSongs";
import { clipLength } from "../lib/roundClip";
import { useAudioBoundary } from "../lib/useAudioBoundary";

type Player = ReturnType<typeof usePlayer>;
export default function NetworkStation({
  access,
  player,
  track,
  localAudio,
  session,
  loadTrack,
  library,
  onExit,
}: {
  access: RoomAccess;
  player: Player;
  track: Track | null;
  localAudio: boolean;
  session: Session;
  loadTrack: (id: number, prepared?: boolean) => Promise<boolean | undefined>;
  library: PreparedSummary[] | null;
  onExit: (state: RoomState | null) => void;
}) {
  const [pairing, setPairing] = useState(true),
    [armed, setArmed] = useState(false),
    [exitConfirm, setExitConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [localError, setLocalError] = useState("");
  const refs = useRef({ player, loadTrack });
  refs.current = { player, loadTrack };
  const prepared = useRef<number | null>(null),
    seen = useRef(new Set<string>());
  const recovery = useRef("");
  const loadGeneration = useRef(0);
  const instruction = (i: Instruction) => {
    if (seen.current.has(i.id)) return;
    seen.current.add(i.id);
    if (seen.current.size > 128)
      seen.current.delete(seen.current.values().next().value!);
    const p = refs.current.player;
    switch (i.type) {
      case "start":
        p.seek(i.position ?? 0);
        void p.play().then((ok) => {
          if (!ok) {
            setArmed(false);
            room.send({ type: "media_error" });
            setLocalError(
              "Браузер не дозволив звук. Натисни «Увімкнути звук» на сцені.",
            );
          }
        });
        break;
      case "play":
        void p.play().then((ok) => {
          if (!ok) {
            setArmed(false);
            room.send({ type: "media_error" });
            setLocalError(
              "Браузер не дозволив звук. Натисни «Увімкнути звук» на сцені.",
            );
          }
        });
        break;
      case "pause":
        p.pause();
        break;
      case "seek":
        p.seek(i.position ?? 0);
        break;
      case "volume":
        p.setVolume(i.position ?? 65);
        break;
      case "load_track":
        if (i.trackId) {
          const generation = ++loadGeneration.current;
          recovery.current = `${room.state?.session.round}:${i.trackId}`;
          prepared.current = i.trackId;
          void refs.current.loadTrack(i.trackId, i.prepared).then((ok) => {
            if (generation !== loadGeneration.current) return;
            if (ok === false) {
              prepared.current = null;
              room.send({ type: "prepare_error" });
            }
          });
        }
        break;
    }
  };
  const room = useStudioConnection(
    { code: access.code, token: access.stationToken, role: "station" },
    instruction,
  );
  usePWAActivity(
    (!room.state && !room.terminal) ||
      room.state?.phase === "playing" ||
      room.state?.phase === "answer" ||
      player.playing ||
      busy,
  );
  useEffect(() => {
    if (room.connected && library !== null)
      room.send({ type: "library", library });
  }, [room.connected, room.send, library]);
  useEffect(() => {
    if (!room.connected) {
      recovery.current = "";
      return;
    }
    const s = room.state;
    const id = s?.session.programme?.trackIds[s.session.round - 1];
    const key = `${s?.session.round}:${id}`;
    if (
      s?.phase !== "ready" ||
      !s.needsTrack ||
      !id ||
      prepared.current !== null ||
      recovery.current === key
    )
      return;
    recovery.current = key;
    prepared.current = id;
    const generation = ++loadGeneration.current;
    void refs.current.loadTrack(id, true).then((ok) => {
      if (generation !== loadGeneration.current) return;
      if (ok === false) {
        prepared.current = null;
        room.send({ type: "prepare_error" });
      }
    });
  }, [room.connected, room.state, room.send]);
  useEffect(() => {
    if (player.failed && room.connected) room.send({ type: "media_error" });
  }, [player.failed, room.connected, room.send]);
  const live = useRef({ player, armed, localAudio, connected: room.connected });
  live.current = { player, armed, localAudio, connected: room.connected };
  useEffect(() => {
    const timer = setInterval(() => {
      const { player: p, armed: a, localAudio: l, connected: c } = live.current;
      if (c)
        room.send({
          type: "telemetry",
          audio: {
            position: p.position,
            duration: p.duration,
            playing: p.playing,
            ready: a && p.ready,
            local: l,
            volume: p.volume,
          },
        });
    }, 200);
    return () => clearInterval(timer);
  }, [room.send]);
  useEffect(() => {
    if (!room.connected) {
      refs.current.player.pause();
      setArmed(false);
    }
  }, [room.connected]);
  const answerStart =
    room.state?.track.cues[room.state.session.target]?.startMs;
  useAudioBoundary(
    player.ref,
    room.connected && room.state?.phase === "playing" && player.playing,
    answerStart === undefined
      ? undefined
      : (answerStart - room.state!.session.offset) / 1000,
    () => {}, // The final audio position is reported to the authoritative room.
  );
  useEffect(() => {
    if (
      prepared.current === track?.id &&
      player.ready &&
      room.connected &&
      room.state?.phase === "ready"
    ) {
      room.send({
        type: "prepare",
        track,
        audio: {
          position: player.position,
          duration: player.duration,
          playing: false,
          ready: armed,
          local: localAudio,
          volume: player.volume,
        },
        offset: session.offset,
        aligned: session.aligned,
        target: Math.max(0, Math.min(session.target, track.cues.length - 1)),
        leadInSeconds: clipLength(session.leadInSeconds),
      });
      prepared.current = null;
    }
  }, [
    track,
    player.ready,
    player.duration,
    room.connected,
    room.state?.phase,
    armed,
    localAudio,
    session.offset,
    session.aligned,
    session.target,
    session.leadInSeconds,
    room.send,
  ]);
  useEffect(() => {
    if (armed && room.presence.host) setPairing(false);
  }, [armed, room.presence.host]);
  useEffect(() => {
    if (room.state) {
      try {
        localStorage.setItem(
          "khz:studio:v1",
          JSON.stringify(room.state.session),
        );
      } catch {}
    }
  }, [room.state?.version]);
  const state = room.state,
    scene = state
      ? roomScene(
          {
            ...state,
            audio: {
              ...state.audio,
              position: player.position,
              playing: player.playing,
            },
          },
          room.serverNow,
          room.connected,
        )
      : null;
  const url = roomURL(access.code, "host", access.hostToken),
    isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      location.hostname,
    );
  const arm = async () => {
    if (!player.ready) return;
    const success = await player.play();
    player.pause();
    if (success) {
      setArmed(true);
      setLocalError("");
    } else setLocalError("Браузер ще не дозволив звук. Натисни ще раз.");
  };
  const exit = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/studio/rooms/${access.code}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${access.stationToken}` },
      });
      if (!response.ok && !room.terminal) throw Error();
      player.pause();
      onExit(state);
    } catch {
      setLocalError(
        "Не вдалося від’єднати пульт. Перевір з’єднання й повтори.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={`app-shell stage-only audience-screen network-station team-${state?.session.team ?? "girls"}`}
    >
      <Backdrop effects={state?.effects ?? true} />
      {scene ? (
        <main>
          <Scoreboard state={scene} />
          <ShowStage state={scene} />
        </main>
      ) : (
        <div className="audience-wait">
          <Radio size={60} />
          <h1>ПІДКЛЮЧАЄМО СЦЕНУ.</h1>
          <p>{room.error || "Готуємо зв’язок із ведучим."}</p>
        </div>
      )}
      {(!room.connected || !armed || player.failed) && (
        <div className="station-alert">
          <Volume2 size={22} />
          <div>
            <strong>
              {!room.connected
                ? "Очікуємо з’єднання"
                : "Дозволь звук на цьому екрані"}
            </strong>
            <p>
              {room.error ||
                "Після цього ведучий зможе запускати музику з телефону."}
            </p>
          </div>
          {room.connected && (
            <Button
              variant="primary"
              disabled={!player.ready}
              onClick={() => void arm()}
            >
              Увімкнути звук
            </Button>
          )}
        </div>
      )}
      {state && !room.presence.host && (
        <div className="connection-notice">
          Пульт ведучого від’єднано. Очікуємо підключення.
        </div>
      )}
      <StageControls className="station-tools">
        <PWAUpdateControl compact={false} />
        <Button onClick={() => setPairing(true)}>
          <Smartphone size={18} />
          Пульт · {access.code}
        </Button>
        <Button
          onClick={() =>
            void document.documentElement.requestFullscreen().catch(() => {})
          }
        >
          <Expand size={18} />
          Повний екран
        </Button>
        <Button onClick={() => setExitConfirm(true)}>
          <ArrowLeft size={18} />
          Локальна гра
        </Button>
      </StageControls>
      <Modal
        open={pairing}
        onOpenChange={setPairing}
        title="Телефон — твій пульт."
        description="Залиш цей екран із музикою. Відкрий приватне посилання на телефоні ведучого."
      >
        <div className="pair-status">
          <span
            className={room.presence.host ? "connected-dot" : "waiting-dot"}
          />
          {room.presence.host
            ? "Пульт ведучого підключено"
            : "Очікуємо ведучого"}
          <b>{access.code}</b>
        </div>
        <div className="pair-qr">
          <QRCodeSVG
            value={url}
            size={212}
            marginSize={4}
            level="M"
            bgColor="#fff7ff"
            fgColor="#21102f"
            title="Відкрити пульт ведучого"
          />
        </div>
        {isLoopback && (
          <div className="notice">
            <Link2 size={18} />
            <span>
              Це локальний перегляд. Телефон зможе під’єднатися за адресою
              сайту, доступною з його мережі. У цьому браузері пульт уже можна
              перевірити.
            </span>
          </div>
        )}
        <a
          className="button specular-button button-primary full-width remote-open"
          href={url}
          target="_blank"
          rel="noopener"
        >
          <span className="specular-button__label">
            <Smartphone size={18} />
            Відкрити пульт
          </span>
        </a>
        <Button
          className="full-width"
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => setCopied(true))
              .catch(() =>
                setLocalError(
                  "Не вдалося скопіювати. Скористайся посиланням вище.",
                ),
              )
          }
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}Скопіювати приватне
          посилання
        </Button>
        {!armed && (
          <Button
            className="full-width"
            variant="primary"
            disabled={!player.ready || !room.connected}
            onClick={() => void arm()}
          >
            <Volume2 size={18} />
            Увімкнути звук на сцені
          </Button>
        )}
        {armed && (
          <div className="pair-ready">
            <Check size={18} />
            Звук готовий до гри.
          </div>
        )}
        {localError && (
          <p role="alert" className="inline-error">
            {localError}
          </p>
        )}
        <p className="modal-footnote">
          Посилання дає керування цією грою. Передай його тільки ведучому. Для
          окремих глядачів використовуй посилання сцени з пульта.
        </p>
      </Modal>
      <Modal
        open={exitConfirm}
        onOpenChange={setExitConfirm}
        title="Повернути локальну гру?"
        description="Пульт на телефоні від’єднається. Рахунок і завершені раунди залишаться на цьому пристрої."
      >
        <div className="action-pair">
          <Button onClick={() => setExitConfirm(false)}>
            Залишити зв’язок
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void exit()}>
            Повернути пульт
          </Button>
        </div>
        {localError && <p className="inline-error">{localError}</p>}
      </Modal>
    </div>
  );
}
