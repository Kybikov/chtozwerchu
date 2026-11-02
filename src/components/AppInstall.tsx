import { useEffect, useState } from "react";
import { Check, Download, Monitor, RefreshCw } from "lucide-react";
import { Button, Modal } from "./ui";
import { usePWA } from "../lib/pwa";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function AppInstall() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [installed, setInstalled] = useState(
    matchMedia("(display-mode: standalone)").matches,
  );
  const {
    needRefresh: [update],
    offlineReady: [ready],
    updateServiceWorker,
    checkForUpdate,
  } = usePWA();
  useEffect(() => {
    const before = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  return (
    <>
      <Button
        variant="ghost"
        className="install-link"
        onClick={() => setOpen(true)}
      >
        <Download size={16} />
        {installed ? "Застосунок встановлено" : "Встановити застосунок"}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Твоє шоу завжди поруч"
        description="Відкривай гру окремим застосунком із головного екрана."
      >
        <div className="home-help">
          <Monitor size={34} />
          <h3>
            {installed
              ? "Уже на твоєму пристрої"
              : "Великий екран. Менше зайвого."}
          </h3>
          <p>
            Встанови «Хто зверху», щоб відкривати гру без адресного рядка.
            Підготовлена локальна музична гра з власним файлом і текстом працює
            без мережі. Для акаунтів, Deezer та мережевих кімнат потрібне
            з’єднання.
          </p>
          {prompt && !installed ? (
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await prompt.prompt();
                  await prompt.userChoice;
                  setPrompt(null);
                } catch {
                  setNotice(
                    "Скористайся пунктом встановлення у меню браузера.",
                  );
                }
              }}
            >
              <Download size={19} />
              Встановити на пристрій
            </Button>
          ) : (
            !installed && (
              <p>
                У меню браузера обери «Встановити застосунок» або «Додати на
                головний екран». Назва пункту залежить від пристрою.
              </p>
            )
          )}
          {ready && (
            <div className="help-check">
              <Check size={18} />
              Оболонку гри збережено для наступного відкриття.
            </div>
          )}
          {!update && (
            <Button
              disabled={checking || !navigator.onLine}
              onClick={async () => {
                setChecking(true);
                setNotice("");
                try {
                  const supported = await checkForUpdate();
                  setNotice(supported
                    ? "Перевірку завершено. Якщо нова версія готова, з’явиться кнопка встановлення."
                    : "Перевірка оновлень недоступна в цьому браузері.");
                } catch {
                  setNotice("Не вдалося перевірити оновлення. Перевір з’єднання й спробуй ще раз.");
                } finally { setChecking(false); }
              }}
            >
              <RefreshCw size={18} className={checking ? "spin" : ""} />
              {checking ? "Перевіряємо…" : "Перевірити оновлення"}
            </Button>
          )}
          {update && (
            <>
              <p>
                Доступне оновлення. Завершіть активні ігри на цьому пристрої
                перед встановленням.
              </p>
              <Button onClick={() => void updateServiceWorker(true)}>
                <RefreshCw size={18} />
                Встановити готове оновлення
              </Button>
            </>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </Modal>
    </>
  );
}
