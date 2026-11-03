import { useEffect, useState } from "react";
import { Monitor, MonitorCheck } from "lucide-react";
import { Button } from "./ui";
import { keepScreenAwake, type ScreenAwakeStatus } from "../lib/screenAwake";

export default function ScreenAwakeButton() {
  const supported = "wakeLock" in navigator;
  const [enabled, setEnabled] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ScreenAwakeStatus>("idle");
  useEffect(() => {
    if (!supported || !enabled) {
      setStatus("idle");
      return;
    }
    return keepScreenAwake({
      request: () => navigator.wakeLock.request("screen"),
      visibility: document,
      visible: () => document.visibilityState === "visible",
      onStatus: setStatus,
    });
  }, [supported, enabled, attempt]);
  if (!supported) return null;
  const active = status === "active";
  return (
    <Button
      className="screen-awake-button"
      aria-pressed={active}
      title={
        active
          ? "Дозволити автоматичне згасання екрана"
          : status === "denied"
            ? "Браузер не дозволив утримувати екран. Спробувати ще раз"
            : "Утримувати екран увімкненим під час шоу"
      }
      onClick={() => {
        if (enabled && status !== "active" && status !== "requesting")
          setAttempt((v) => v + 1);
        else setEnabled((v) => !v);
      }}
    >
      {active ? <MonitorCheck size={18} /> : <Monitor size={18} />}
      {active
        ? "Без автосну"
        : status === "requesting"
          ? "Вмикаємо екран…"
          : "Не гасити екран"}
    </Button>
  );
}
