import { useState } from "react";
import { Expand, Monitor } from "lucide-react";
import { Button } from "./ui";
import StageControls from "./StageControls";
import { usePWAActivity } from "../lib/pwa";
import { PWAUpdateControl } from "./PWAUpdate";
import Backdrop from "./Backdrop";
import ShowStage, { Scoreboard } from "./ShowStage";
import { linkConnection, useStudioConnection } from "../lib/studioRoom";

export default function RoomAudience() {
  const [connection] = useState(() => linkConnection("audience"));
  const room = useStudioConnection(connection),
    scene = room.scene;
  usePWAActivity(
    (!scene && !room.terminal) ||
      scene?.phase === "playing" ||
      scene?.phase === "answer" ||
      !!scene?.playing,
    true,
  );
  return (
    <div
      className={`app-shell stage-only audience-screen team-${scene?.team ?? "girls"}`}
    >
      <Backdrop effects={scene?.effects ?? true} />
      {scene ? (
        <main>
          <Scoreboard state={scene} />
          <ShowStage state={scene} />
        </main>
      ) : (
        <div className="audience-wait">
          <Monitor size={64} />
          <h1>СЦЕНА ЧЕКАЄ.</h1>
          <p>{room.error || "Підключаємося до музичної битви…"}</p>
        </div>
      )}
      {scene && (!room.connected || !room.presence.station) && (
        <div className="connection-notice">
          {room.error || "Екран зі звуком від’єднано. Гру призупинено."}
        </div>
      )}
      <StageControls>
        <PWAUpdateControl compact={false} />
        <Button
          onClick={() =>
            void document.documentElement.requestFullscreen().catch(() => {})
          }
        >
          <Expand size={18} />
          Повний екран
        </Button>
      </StageControls>
    </div>
  );
}
