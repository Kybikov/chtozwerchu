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
import { PWAUpdateDialog } from "./components/PWAUpdate";
const PartyScreen = lazy(() => import("./components/PartyScreen"));
import "./styles.css";
import "./platform.css";
import "./party.css";
import "./party-extensions.css";
import "./party-buzzer.css";
import "./readability.css";
import "./headers.css";
import "./dialogs.css";
import "./pwa.css";
import "./account.css";
// Return to the normal app URL after the network-only recovery entry point
// has loaded. This also keeps the window in the existing PWA activity guard.
if (location.pathname === "/api/app-shell") {
  history.replaceState(history.state, "", "/" + location.search + location.hash);
}
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
        <PWAUpdateDialog />
      </IdentityProvider>
    </PWAProvider>
  </React.StrictMode>,
);
