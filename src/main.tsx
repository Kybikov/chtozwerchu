import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/onest";
import "@fontsource-variable/oswald";
import App from "./App";
import AudienceScreen from "./components/AudienceScreen";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get("screen") === "show" ? (
      <AudienceScreen />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
