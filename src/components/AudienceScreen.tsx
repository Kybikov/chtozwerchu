import { useEffect, useRef, useState } from "react";
import { Expand, Monitor, Radio } from "lucide-react";
import Backdrop from "./Backdrop";
import ShowStage, { Scoreboard } from "./ShowStage";
import { Button } from "./ui";
import StageControls from "./StageControls";
import { usePWAActivity } from "../lib/pwa";
import { PWAUpdateControl } from "./PWAUpdate";
import type { ShowState } from "../lib/show";

export default function AudienceScreen() {
  const [state, setState] = useState<ShowState | null>(null);
  const [connected, setConnected] = useState(false);
  usePWAActivity(
    state?.phase === "playing" || state?.phase === "answer" || !!state?.playing,
    true,
  );
  const last = useRef(0);
  useEffect(() => {
    const room = new URLSearchParams(location.search).get("room");
    if (!room || !("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(`khz:show:${room}`);
    channel.onmessage = (e) => {
      if (
        e.data?.type !== "scene" ||
        !e.data.state?.names ||
        !e.data.state?.scores
      )
        return;
      last.current = performance.now();
      setState(e.data.state);
      setConnected(true);
    };
    channel.postMessage({ type: "hello" });
    const interval = setInterval(
      () => setConnected(performance.now() - last.current < 3000),
      1000,
    );
    return () => {
      channel.close();
      clearInterval(interval);
    };
  }, []);
  return (
    <div
      className={`app-shell stage-only audience-screen team-${state?.team ?? "girls"}`}
    >
      <Backdrop effects={state?.effects ?? true} />
      {state ? (
        <main>
          <Scoreboard state={state} />
          <ShowStage state={state} />
        </main>
      ) : (
        <div className="audience-wait">
          <Monitor size={64} />
          <h1>СЦЕНА ЧЕКАЄ.</h1>
          <p>Відкрий цей екран із пульта ведучого.</p>
        </div>
      )}
      {state && !connected && (
        <div className="connection-notice">
          <Radio size={18} />
          Пульт на паузі. Поверніться до вікна ведучого.
        </div>
      )}
      <StageControls>
        <PWAUpdateControl compact={false} />
        <Button
          onClick={() =>
            void document.documentElement.requestFullscreen().catch(() => {})
          }
        >
          <Expand size={20} />
          Повний екран
        </Button>
      </StageControls>
    </div>
  );
}
