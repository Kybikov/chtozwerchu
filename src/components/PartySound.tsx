import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Headphones,
  LoaderCircle,
  Monitor,
  Play,
  Smartphone,
  Volume2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button, ButtonLink, Modal } from "./ui";
import WakeSlider from "./react-bits/WakeSlider";
import type { PartyView } from "../lib/party";
import { appEntryURL } from "../lib/appEntry";

export default function PartySound({
  state,
  tvToken,
  online,
  pending,
  armed,
  ownerHere,
  allowSound,
  action,
  onNotice,
  sharedScreen = false,
}: {
  state: PartyView;
  tvToken: string;
  online: boolean;
  pending: boolean;
  armed: boolean;
  ownerHere: boolean;
  allowSound: () => Promise<void>;
  action: (name: string, payload?: Record<string, unknown>) => boolean;
  onNotice: (m: string) => void;
  sharedScreen?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [copied, setCopied] = useState(false),
    [volume, setVolume] = useState(state.media?.volume ?? 65);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    [unlocking, setUnlocking] = useState(false);
  useEffect(() => setVolume(state.media?.volume ?? 65), [state.media?.volume]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const m = state.media;
  const url = appEntryURL(
    `${location.origin}/?screen=party&code=${state.code}&watch=1&audio=1#tv=${encodeURIComponent(tvToken)}`,
    location.origin,
  );
  const enable = async () => {
    setUnlocking(true);
    await allowSound();
    setUnlocking(false);
  };
  return (
    <>
      <div className="party-sound-card">
        <div className="section-label">
          <Headphones size={16} />
          ДЕ ЗВУЧИТЬ ШОУ
        </div>
        {!sharedScreen && (
          <div className="sound-output-options">
            <Button
              className={m?.output !== "tv" ? "selected" : ""}
              aria-pressed={m?.output !== "tv"}
              disabled={!online || pending}
              onClick={() => action("audio_output", { output: "host" })}
            >
              <Smartphone size={18} />
              Тут
            </Button>
            <Button
              className={m?.output === "tv" ? "selected" : ""}
              aria-pressed={m?.output === "tv"}
              disabled={!online || pending}
              onClick={() => {
                action("audio_output", { output: "tv" });
                setOpen(true);
              }}
            >
              <Monitor size={18} />
              На TV
            </Button>
          </div>
        )}
        <p>
          {m?.output === "tv"
            ? m.tvConnected
              ? m.enabled
                ? "TV підключений. Звук дозволено."
                : "TV підключений. Натисни на ньому «Дозволити звук»."
              : sharedScreen
                ? "Підключи TV з особистого пульта ведучого."
                : "Відкрий посилання TV на екрані зі звуком."
            : armed
              ? "Звук на цьому пристрої дозволено."
              : "Дозволь звук один раз перед початком музики."}
        </p>
        {ownerHere && !armed && (
          <Button
            className="allow-host-sound"
            onClick={() => void enable()}
            disabled={unlocking || !online}
          >
            {unlocking ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Volume2 size={17} />
            )}
            Дозволити звук
          </Button>
        )}
        {!sharedScreen && m?.output === "tv" && (
          <Button
            variant="ghost"
            onClick={() => setOpen(true)}
            disabled={!tvToken}
          >
            <Monitor size={16} />
            Посилання для TV
          </Button>
        )}
        <div className="party-volume">
          <Volume2 size={17} />
          <WakeSlider
            value={volume}
            disabled={!online}
            onChange={(v) => {
              setVolume(v);
              clearTimeout(timer.current);
              timer.current = setTimeout(
                () => action("audio_volume", { volume: v }),
                140,
              );
            }}
            ariaLabel="Гучність сцени"
          />
        </div>
        {m?.notice && (
          <p className="sound-notice" role="status">
            {m.notice}
          </p>
        )}
      </div>
      <Modal
        open={open && !sharedScreen}
        onOpenChange={setOpen}
        title="Великий екран. Великий звук."
        description="Відкрий це посилання на TV або ноутбуці з колонками. Потім один раз дозволь звук на тому екрані."
      >
        <div className="party-invite">
          <div className="invite-qr">
            <QRCodeSVG
              value={url}
              size={178}
              bgColor="#f3eaff"
              fgColor="#21152c"
              level="M"
            />
          </div>
          <div className="tv-pair-status">
            <span
              className={`connection-dot ${m?.tvConnected ? "online" : ""}`}
            />
            {m?.tvConnected ? "TV підключений" : "Очікуємо TV"}
          </div>
          <Button
            disabled={!tvToken}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                onNotice("Копіювання недоступне. Скористайся QR-кодом.");
              }
            }}
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}Скопіювати
            посилання TV
          </Button>
          <ButtonLink variant="soft" href={url} target="_blank" rel="noopener">
            <Monitor size={18} />
            Відкрити TV у новому вікні
          </ButtonLink>
          <p>
            TV отримує сцену й команди музики. Приховані картки та керування
            балами залишаються на пульті ведучого.
          </p>
        </div>
      </Modal>
    </>
  );
}

export function TVSoundGate({
  armed,
  online,
  selected,
  allowSound,
}: {
  armed: boolean;
  online: boolean;
  selected: boolean;
  allowSound: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (armed)
    return (
      <div className="tv-audio-badge">
        <Volume2 size={15} />
        {selected ? "Звук TV дозволено" : "TV готовий. Обери його на пульті."}
      </div>
    );
  return (
    <div className="tv-sound-gate">
      <div>
        <Monitor size={35} />
        <span className="section-label">ЦЕ ВАША СЦЕНА</span>
        <h2>
          ДАЙ ЗВУКУ
          <br />
          <span>ЗАПОВНИТИ КІМНАТУ.</span>
        </h2>
        <p>
          Один дотик тут — і далі музику вмикатиме ведучий зі свого телефона.
        </p>
        <Button
          variant="primary"
          disabled={!online || busy}
          onClick={async () => {
            setBusy(true);
            await allowSound();
            setBusy(false);
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={21} />
          ) : (
            <Play size={21} />
          )}
          Дозволити звук
        </Button>
      </div>
    </div>
  );
}
