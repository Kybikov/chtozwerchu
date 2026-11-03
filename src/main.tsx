import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/onest";
import "@fontsource-variable/oswald";
import App from "./App";
import AudienceScreen from "./components/AudienceScreen";
import RemotePanel from "./components/RemotePanel";
import RoomAudience from "./components/RoomAudience";
import Home from "./components/Home";
import { IdentityProvider } from "./lib/identity";
import { PWAProvider } from "./lib/pwa";
const PartyScreen = lazy(() => import("./components/PartyScreen"));
import "./styles.css";
import "./platform.css";
import "./party.css";
import "./party-extensions.css";
import "./party-buzzer.css";
import "./readability.css";
import "./dialogs.css";
import "./account.css";
const screen = new URLSearchParams(location.search).get("screen");
const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <React.StrictMode>
    <PWAProvider>
      <IdentityProvider>
        <Suspense
          fallback={
            <div className="route-loading" role="status">
              Збираємо твоє шоу…
            </div>
          }
        >
          {screen === "remote" ? (
            <RemotePanel />
          ) : screen === "room" ? (
            <RoomAudience />
          ) : screen === "show" ? (
            <AudienceScreen />
          ) : screen === "studio" ? (
            <App />
          ) : screen === "party" ? (
            <PartyScreen />
          ) : (
            <Home />
          )}
        </Suspense>
      </IdentityProvider>
    </PWAProvider>
  </React.StrictMode>,
);
