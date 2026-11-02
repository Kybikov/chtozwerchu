import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayer } from "./usePlayer";
import type { useParty } from "./partyConnection";

function silence() {
  const b = new Uint8Array(1644),
    v = new DataView(b.buffer);
  const word = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
  };
  word(0, "RIFF");
  v.setUint32(4, b.length - 8, true);
  word(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  word(36, "data");
  v.setUint32(40, 1600, true);
  return "data:audio/wav;base64," + btoa(String.fromCharCode(...b));
}
const SILENCE = silence();
type Party = ReturnType<typeof useParty>;
export function usePartyAudio(party: Party, onNotice: (s: string) => void) {
  const s = party.state,
    m = s?.media;
  const [armed, setArmed] = useState(false),
    unlocking = useRef(false);
  const tones = useRef<AudioContext | null>(null);
  const lastBuzz = useRef("");
  const online = party.status === "connected";
  const ownerHere =
    !!s &&
    ((party.isTV && m?.output === "tv") ||
      (!party.watching && !!s.you?.host && m?.output === "host"));
  const source =
    ownerHere && s?.roundType === "melody" && s.stage === "playing"
      ? s.round?.previewUrl || ""
      : "";
  const player = usePlayer(source, onNotice);
  const refs = useRef({
    party,
    s,
    m,
    armed,
    online,
    ownerHere,
    source,
    onNotice,
  });
  refs.current = { party, s, m, armed, online, ownerHere, source, onNotice };
  useEffect(
    () => () => {
      void tones.current?.close();
    },
    [],
  );
  const buzz = s?.round?.buzzer;
  useEffect(() => {
    const key = s ? `${s.code}:${s.roundIndex}:${buzz?.attempt || 0}` : "";
    const previous = lastBuzz.current;
    lastBuzz.current = key;
    const context = tones.current;
    if (
      !previous ||
      previous === key ||
      buzz?.phase !== "answer" ||
      !ownerHere ||
      !armed ||
      !online ||
      document.hidden ||
      context?.state !== "running" ||
      m?.volume === 0 ||
      localStorage.getItem("khz:effects") === "off"
    )
      return;
    const gain = context.createGain();
    gain.connect(context.destination);
    const at = context.currentTime;
    const volume = Math.min(0.09, ((m?.volume ?? 65) / 100) * 0.09);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
    for (const [index, frequency] of [880, 1320].entries()) {
      const note = context.createOscillator();
      note.type = "sine";
      note.frequency.value = frequency;
      note.connect(gain);
      note.start(at + index * 0.07);
      note.stop(at + 0.34);
      note.onended = () => {
        note.disconnect();
        if (index === 1) gain.disconnect();
      };
    }
  }, [
    s?.code,
    s?.roundIndex,
    buzz?.attempt,
    buzz?.phase,
    ownerHere,
    armed,
    online,
  ]);
  const report = useCallback((failed = false) => {
    const x = refs.current,
      a = player.ref.current;
    if (!x.online || !x.ownerHere || !x.s || !x.m || !a || unlocking.current)
      return;
    const duration = Number.isFinite(a.duration) && x.source ? a.duration : 0;
    const ready =
      x.armed &&
      !document.hidden &&
      !!x.source &&
      a.getAttribute("src") === x.source &&
      a.readyState >= 1 &&
      duration > 0 &&
      !a.error;
    x.party.send("media_status", {
      revision: x.m.revision,
      round: x.s.roundIndex,
      enabled: x.armed,
      ready: ready && !failed,
      playing: ready && !failed && !a.paused,
      position: Math.max(0, Math.min(duration, a.currentTime || 0)),
      duration,
      failed,
    });
  }, []);
  useEffect(() => {
    const timer = setInterval(() => report(), 250);
    return () => clearInterval(timer);
  }, [report]);
  useEffect(() => {
    if (m) player.setVolume(m.volume);
  }, [m?.volume]);
  useEffect(() => {
    const a = player.ref.current;
    if (!a) return;
    if (!online || !ownerHere || !armed || !m?.wanted) {
      a.pause();
      return;
    }
    if (!m.pending) return;
    let cancelled = false;
    if (Number.isFinite(a.duration))
      a.currentTime = Math.max(0, Math.min(m.position, a.duration - 0.01));
    void player.play().then((ok) => {
      if (cancelled) return;
      if (!ok) setArmed(false);
      report(!ok);
    });
    return () => {
      cancelled = true;
    };
  }, [m?.revision, m?.wanted, m?.pending, online, ownerHere, armed, source]);
  useEffect(() => {
    if (!online) {
      player.pause();
    }
  }, [online]);
  useEffect(() => {
    const hidden = () => {
      const x = refs.current;
      if (!document.hidden) return;
      if (x.ownerHere && (x.m?.wanted || x.m?.pending || x.m?.playing)) {
        player.pause();
        report(true);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [report]);
  const allowSound = async () => {
    const a = player.ref.current;
    if (!a || unlocking.current) return;
    unlocking.current = true;
    try {
      try {
        tones.current ??= new AudioContext();
        void tones.current.resume().catch(() => {});
      } catch {
        /* Music playback remains available without sound effects. */
      }
      // Authorize this media element with a user gesture and silent PCM.
      a.src = SILENCE;
      a.load();
      await a.play();
      a.pause();
      setArmed(true);
    } catch {
      setArmed(false);
      refs.current.onNotice(
        "Браузер не дозволив звук. Торкнися кнопки ще раз.",
      );
    } finally {
      const next = refs.current.source;
      if (next) a.src = next;
      else a.removeAttribute("src");
      a.load();
      unlocking.current = false;
    }
  };
  return { player, armed, ownerHere, allowSound, source };
}
