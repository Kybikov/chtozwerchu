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
